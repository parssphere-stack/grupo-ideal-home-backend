const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/conversation.model');
const Property = require('../models/property.model');
const aiService = require('./ai.service');

class ChatService {
  /**
   * Start a new conversation
   */
  async startConversation({ channel = 'widget', language = 'es', source_url, ip_address, user_agent }) {
    const session_id = uuidv4();

    const conversation = new Conversation({
      session_id,
      channel,
      language,
      source_url,
      ip_address,
      user_agent,
      status: 'active'
    });

    // Add initial greeting
    const greetings = {
      es: '¡Hola! 👋 Soy el asistente virtual de Grupo Ideal Home. Estoy aquí para ayudarte a encontrar la propiedad perfecta en España. ¿Buscas comprar, alquilar o invertir?',
      en: 'Hello! 👋 I\'m the virtual assistant of Grupo Ideal Home. I\'m here to help you find the perfect property in Spain. Are you looking to buy, rent, or invest?',
      de: 'Hallo! 👋 Ich bin der virtuelle Assistent von Grupo Ideal Home. Ich helfe Ihnen, die perfekte Immobilie in Spanien zu finden. Suchen Sie zum Kaufen, Mieten oder Investieren?',
      fr: 'Bonjour! 👋 Je suis l\'assistant virtuel de Grupo Ideal Home. Je suis là pour vous aider à trouver la propriété parfaite en Espagne. Cherchez-vous à acheter, louer ou investir?',
      uk: 'Привіт! 👋 Я віртуальний асистент Grupo Ideal Home. Я тут, щоб допомогти вам знайти ідеальну нерухомість в Іспанії. Ви шукаєте купити, орендувати чи інвестувати?',
      nl: 'Hallo! 👋 Ik ben de virtuele assistent van Grupo Ideal Home. Ik ben hier om u te helpen de perfecte woning in Spanje te vinden. Zoekt u om te kopen, huren of investeren?',
      it: 'Ciao! 👋 Sono l\'assistente virtuale di Grupo Ideal Home. Sono qui per aiutarti a trovare la proprietà perfetta in Spagna. Cerchi di comprare, affittare o investire?'
    };

    const greeting = greetings[language] || greetings.es;
    conversation.messages.push({
      role: 'assistant',
      content: greeting,
      metadata: { detected_language: language }
    });

    await conversation.save();

    return {
      session_id,
      greeting,
      language
    };
  }

  /**
   * Process a user message and get AI response
   */
  async processMessage(session_id, userMessage) {
    const conversation = await Conversation.findOne({ session_id });
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Detect language
    const detectedLang = aiService.detectMessageLanguage(userMessage);
    if (detectedLang !== conversation.language) {
      conversation.language = detectedLang;
    }

    // Add user message
    conversation.messages.push({
      role: 'user',
      content: userMessage,
      metadata: { detected_language: detectedLang }
    });

    // Search for matching properties if we have enough context
    let matchedProperties = [];
    if (conversation.messages.length > 3) {
      matchedProperties = await this._searchMatchingProperties(conversation);
    }

    // Get AI response
    const history = conversation.getAIHistory();
    const aiResponse = await aiService.generateResponse(
      history,
      conversation.language,
      { matchedProperties }
    );

    // Add AI response
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse.content,
      metadata: {
        detected_language: conversation.language,
        tokens_used: aiResponse.tokens_used,
        response_time_ms: aiResponse.response_time_ms
      }
    });

    // Extract lead info every 4 messages
    if (conversation.messages.length % 4 === 0) {
      await this._updateLeadInfo(conversation);
    }

    await conversation.save();

    return {
      response: aiResponse.content,
      language: conversation.language,
      response_time_ms: aiResponse.response_time_ms,
      lead_score: conversation.lead_info?.score || 0,
      matched_properties: matchedProperties.length
    };
  }

  /**
   * Search properties matching conversation context
   */
  async _searchMatchingProperties(conversation) {
    const lead = conversation.lead_info;
    if (!lead) return [];

    const query = { status: 'active' };

    if (lead.looking_for === 'buy') query.operation = 'sale';
    else if (lead.looking_for === 'rent') query.operation = 'rent';

    if (lead.budget_max) query.price = { $lte: lead.budget_max };
    if (lead.budget_min) {
      query.price = { ...query.price, $gte: lead.budget_min };
    }

    if (lead.preferred_areas?.length > 0) {
      query.$or = [
        { 'location.district': { $in: lead.preferred_areas } },
        { 'location.neighborhood': { $in: lead.preferred_areas } },
        { 'location.city': { $in: lead.preferred_areas } }
      ];
    }

    if (lead.bedrooms) {
      query['features.bedrooms'] = { $gte: lead.bedrooms };
    }

    if (lead.property_type && lead.property_type !== 'unknown') {
      query.type = lead.property_type;
    }

    try {
      return await Property.find(query)
        .sort({ price: 1 })
        .limit(5)
        .lean();
    } catch (error) {
      console.error('Property search error:', error.message);
      return [];
    }
  }

  /**
   * Update lead information from conversation
   */
  async _updateLeadInfo(conversation) {
    try {
      const history = conversation.getAIHistory(10);
      const extractedInfo = await aiService.extractLeadInfo(history, conversation.language);

      if (extractedInfo) {
        // Merge with existing info (don't overwrite with nulls)
        const current = conversation.lead_info || {};
        for (const [key, value] of Object.entries(extractedInfo)) {
          if (value !== null && value !== undefined) {
            current[key] = value;
          }
        }

        // Calculate score
        current.score = aiService.calculateLeadScore(current);
        conversation.lead_info = current;

        // Auto-qualify if score is high enough
        if (current.score >= 60 && conversation.status === 'active') {
          conversation.status = 'qualified';
          conversation.tags.push('auto-qualified');
        }
      }
    } catch (error) {
      console.error('Lead info update error:', error.message);
    }
  }

  /**
   * Hand off conversation to human agent
   */
  async handoffToAgent(session_id, agent_id, reason) {
    const conversation = await Conversation.findOne({ session_id });
    if (!conversation) throw new Error('Conversation not found');

    conversation.status = 'handed_off';
    conversation.assigned_agent = agent_id;
    conversation.handed_off_at = new Date();
    conversation.tags.push(`handoff:${reason}`);

    await conversation.save();
    return conversation;
  }

  /**
   * Get conversation by session ID
   */
  async getConversation(session_id) {
    return Conversation.findOne({ session_id }).populate('assigned_agent');
  }

  /**
   * Get all conversations with filters
   */
  async getConversations({ status, channel, page = 1, limit = 20 }) {
    const query = {};
    if (status) query.status = status;
    if (channel) query.channel = channel;

    const total = await Conversation.countDocuments(query);
    const conversations = await Conversation.find(query)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('assigned_agent')
      .lean();

    return {
      conversations,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }
}

module.exports = new ChatService();
