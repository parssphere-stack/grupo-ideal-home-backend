const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { getSystemPrompt, detectLanguage, LEAD_SCORING } = require('../config/ai.config');

class AIService {
  constructor() {
    this.provider = process.env.AI_PROVIDER || 'anthropic';

    if (this.provider === 'anthropic') {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
    } else {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
  }

  /**
   * Generate AI response for a conversation
   */
  async generateResponse(conversationHistory, language = 'es', context = {}) {
    const startTime = Date.now();

    try {
      const systemPrompt = getSystemPrompt(language);

      // Add property context if available
      let enhancedSystem = systemPrompt;
      if (context.matchedProperties && context.matchedProperties.length > 0) {
        enhancedSystem += '\n\nPROPIEDADES DISPONIBLES QUE COINCIDEN:\n';
        context.matchedProperties.forEach((p, i) => {
          enhancedSystem += `${i + 1}. ${p.title} - ${p.price_formatted || p.price + '€'} - ${p.location?.district || ''}, ${p.location?.city || ''} - ${p.features?.bedrooms || '?'} hab, ${p.features?.size_sqm || '?'}m²\n`;
        });
      }

      let response;

      if (this.provider === 'anthropic') {
        response = await this._callAnthropic(enhancedSystem, conversationHistory);
      } else {
        response = await this._callOpenAI(enhancedSystem, conversationHistory);
      }

      const responseTime = Date.now() - startTime;

      return {
        content: response.content,
        tokens_used: response.tokens,
        response_time_ms: responseTime,
        detected_language: language
      };
    } catch (error) {
      console.error('AI Service Error:', error.message);
      throw error;
    }
  }

  /**
   * Call Anthropic Claude API
   */
  async _callAnthropic(systemPrompt, messages) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    });

    return {
      content: response.content[0].text,
      tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0
    };
  }

  /**
   * Call OpenAI API
   */
  async _callOpenAI(systemPrompt, messages) {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      ]
    });

    return {
      content: response.choices[0].message.content,
      tokens: response.usage?.total_tokens || 0
    };
  }

  /**
   * Extract lead information from conversation using AI
   */
  async extractLeadInfo(conversationHistory, language = 'es') {
    const extractionPrompt = `Analiza la siguiente conversación y extrae la información del lead en formato JSON.
    
Devuelve SOLO un JSON válido con estos campos (usa null si no se mencionó):
{
  "name": string | null,
  "email": string | null,
  "phone": string | null,
  "budget_min": number | null,
  "budget_max": number | null,
  "looking_for": "buy" | "rent" | "invest" | "unknown",
  "property_type": "apartment" | "house" | "villa" | "studio" | "penthouse" | "commercial" | "land" | "unknown",
  "preferred_areas": string[] | [],
  "bedrooms": number | null,
  "special_requirements": string[] | [],
  "timeline": string | null,
  "has_financing": boolean | null,
  "has_visited": boolean | null,
  "nationality": string | null
}`;

    try {
      const messages = [
        ...conversationHistory,
        { role: 'user', content: extractionPrompt }
      ];

      let result;
      if (this.provider === 'anthropic') {
        result = await this._callAnthropic('You are a data extraction assistant. Return only valid JSON.', messages);
      } else {
        result = await this._callOpenAI('You are a data extraction assistant. Return only valid JSON.', messages);
      }

      // Parse JSON from response
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (error) {
      console.error('Lead extraction error:', error.message);
      return null;
    }
  }

  /**
   * Calculate lead score based on extracted info
   */
  calculateLeadScore(leadInfo) {
    let score = 0;

    if (leadInfo.budget_min || leadInfo.budget_max) score += LEAD_SCORING.has_budget;
    if (leadInfo.timeline) score += LEAD_SCORING.has_timeline;
    if (leadInfo.preferred_areas?.length > 0) score += LEAD_SCORING.has_area_preference;
    if (leadInfo.special_requirements?.length > 0) score += LEAD_SCORING.has_specific_requirements;
    if (leadInfo.has_financing) score += LEAD_SCORING.has_financing;
    if (leadInfo.has_visited) score += LEAD_SCORING.has_visited;
    if (leadInfo.email || leadInfo.phone) score += LEAD_SCORING.provided_contact_info;

    return score;
  }

  /**
   * Detect language from user message
   */
  detectMessageLanguage(text) {
    return detectLanguage(text);
  }
}

module.exports = new AIService();
