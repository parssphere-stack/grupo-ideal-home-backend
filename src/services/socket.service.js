const chatService = require('./chat.service');

function setupSocketHandlers(io) {
  // Widget namespace - for customer-facing chat
  const widgetNsp = io.of('/widget');

  widgetNsp.on('connection', (socket) => {
    console.log(`Widget client connected: ${socket.id}`);

    // Start new conversation
    socket.on('start_conversation', async (data) => {
      try {
        const result = await chatService.startConversation({
          channel: data.channel || 'widget',
          language: data.language || 'es',
          source_url: data.source_url,
          ip_address: socket.handshake.address,
          user_agent: socket.handshake.headers['user-agent']
        });

        socket.session_id = result.session_id;
        socket.join(result.session_id);

        socket.emit('conversation_started', {
          session_id: result.session_id,
          greeting: result.greeting,
          language: result.language
        });

        // Notify dashboard
        io.of('/dashboard').emit('new_conversation', {
          session_id: result.session_id,
          channel: data.channel || 'widget',
          language: result.language,
          started_at: new Date()
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Send message
    socket.on('send_message', async (data) => {
      try {
        const { session_id, message } = data;

        // Emit typing indicator
        socket.emit('typing', { is_typing: true });

        const result = await chatService.processMessage(session_id, message);

        socket.emit('typing', { is_typing: false });
        socket.emit('message_received', {
          session_id,
          response: result.response,
          language: result.language,
          response_time_ms: result.response_time_ms,
          lead_score: result.lead_score,
          matched_properties: result.matched_properties
        });

        // Notify dashboard of updated conversation
        io.of('/dashboard').emit('conversation_updated', {
          session_id,
          last_message: message,
          lead_score: result.lead_score,
          language: result.language
        });
      } catch (error) {
        socket.emit('typing', { is_typing: false });
        socket.emit('error', { message: error.message });
      }
    });

    // Request handoff to human
    socket.on('request_handoff', async (data) => {
      try {
        const conversation = await chatService.handoffToAgent(
          data.session_id,
          data.agent_id,
          data.reason || 'customer_request'
        );

        socket.emit('handoff_initiated', {
          session_id: data.session_id,
          agent_id: data.agent_id
        });

        // Notify dashboard
        io.of('/dashboard').emit('handoff_requested', {
          session_id: data.session_id,
          reason: data.reason
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Widget client disconnected: ${socket.id}`);
    });
  });

  // Dashboard namespace - for agents/managers
  const dashboardNsp = io.of('/dashboard');

  dashboardNsp.on('connection', (socket) => {
    console.log(`Dashboard client connected: ${socket.id}`);

    // Agent takes over conversation
    socket.on('takeover_conversation', async (data) => {
      try {
        const { session_id, agent_id } = data;
        socket.join(session_id);

        // Notify widget that human agent joined
        widgetNsp.to(session_id).emit('agent_joined', {
          agent_name: data.agent_name
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Agent sends message directly
    socket.on('agent_message', async (data) => {
      const { session_id, message, agent_name } = data;

      // Forward to widget
      widgetNsp.to(session_id).emit('message_received', {
        session_id,
        response: message,
        is_human: true,
        agent_name
      });
    });

    socket.on('disconnect', () => {
      console.log(`Dashboard client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocketHandlers };
