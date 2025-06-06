require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const WebSocket = require('ws');
const axios = require('axios'); // 🆕 Added for copilot requests

const app = express();
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const PORT = 8000;
const WS_PORT = 8081;
const SUGGESTION_WS_PORT = 8082; // 🆕 New port for suggestions

const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const jothPhone = process.env.JOTHPHONE;
const vrajPhone = process.env.VRAJPHONE;
const listenerPhone = process.env.LISTENER_PHONE;
const SUGGESTION_WS_URL = process.env.SUGGESTION_WS_URL; // 🆕 Cloud tunnel URL

const mediaStreamWsUrl = process.env.MEDIA_STREAM_WS;
let DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

let currentConference = null;

// 🆕 Copilot integration variables
let currentTranscript = [];
let currentSuggestions = [];
let suggestionClients = [];

// 🆕 Copilot configuration
const COPILOT_URL = process.env.COPILOT_URL || 'https://1e1c-14-194-2-90.ngrok-free.app/copilot';
const LEAD_ID = process.env.LEAD_ID || "7d4d4c68-ec85-4cca-aecb-e1a4daad5dca";

// 🧠 Import Deepgram and set up API key
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const deepgram = createClient(DEEPGRAM_API_KEY);

// 🎧 WebSocket server to receive Twilio Media Stream
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (twilioWs) => {
  console.log('✅ WebSocket: Twilio Media Stream connected');

  // 🎯 Connect to Deepgram for STT with updated syntax
  const deepgramWs = deepgram.listen.live({
    model: 'nova-3', // Use nova-3 for better accuracy
    multichannel: true, // Transcribe each audio channel independently
    punctuate: true, // Add punctuation and capitalization
    interim_results: true, // Receive ongoing transcription updates
    vad_events: true, // Detect speech start events
    smart_format: true, // Improve transcript readability
    encoding: 'mulaw', // Twilio uses mulaw encoding
    sample_rate: 8000, // Twilio's sample rate
    channels: 1, // Single channel for Twilio stream
    language: "multi",// English language
  });

  // Handle Deepgram WebSocket events
  deepgramWs.on(LiveTranscriptionEvents.Open, () => {
    console.log('🔊 Connected to Deepgram STT WebSocket');

    // Handle transcriptions
    deepgramWs.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      const isFinal = data.is_final;
      const speechFinal = data.speech_final;
      
      if (transcript && transcript !== '') {
        console.log(`📝 Transcription (is_final: ${isFinal}, speech_final: ${speechFinal}):`, transcript);
        
        // 🆕 Store final transcripts for copilot
        if (isFinal && transcript.trim() !== '') {
          const transcriptEntry = { role: 'call', message: transcript.trim() };
          currentTranscript.push(transcriptEntry);
          console.log(`💾 Stored transcript for copilot:`, transcriptEntry);
          console.log(`📊 Total transcript entries: ${currentTranscript.length}`);
        }
      }
    });

    // Handle speech start events
    deepgramWs.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
      console.log('🗣️ Speech started:', data);
    });

    // Handle utterance end events
    deepgramWs.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      console.log('🛑 Utterance ended:', data);
    });

    // Handle errors
    deepgramWs.on(LiveTranscriptionEvents.Error, (err) => {
      console.error('❌ Deepgram WebSocket Error:', err);
    });

    // Handle connection close
    deepgramWs.on(LiveTranscriptionEvents.Close, () => {
      console.log('🔌 Deepgram WebSocket closed');
    });

    // 🔁 Receive audio from Twilio and send to Deepgram (emulating source.addListener)
    twilioWs.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);

        switch (data.event) {
          case 'start':
            console.log('🎙️ Twilio Stream started:', data.streamSid);
            break;

          case 'media':
            const audio = Buffer.from(data.media.payload, 'base64');
            if (deepgramWs.getReadyState() === 1) {
              deepgramWs.send(audio); // Send raw audio data to Deepgram
            }
            break;

          case 'stop':
            console.log('🛑 Twilio Stream stopped');
            deepgramWs.send(JSON.stringify({ type: 'CloseStream' })); // Send CloseStream message
            break;

          default:
            console.log('📩 Unknown Twilio event:', data.event);
        }
      } catch (err) {
        console.error('❌ Invalid message format:', err);
      }
    });
  });

  twilioWs.on('close', () => {
    console.log('🔌 Twilio WebSocket closed');
    deepgramWs.send(JSON.stringify({ type: 'CloseStream' })); // Ensure Deepgram connection closes
    
    // Clear the conference and transcript when call ends
    console.log('🧹 Call ended - clearing conference and transcript data');
    console.log(`📊 Final transcript count before clearing: ${currentTranscript.length}`);
    currentConference = null;
    currentTranscript = [];
  });

  twilioWs.on('error', (err) => {
    console.error('❌ Twilio WebSocket Error:', err);
    deepgramWs.send(JSON.stringify({ type: 'CloseStream' }));
  });
});

// 🔁 Auto-send transcript to copilot every 10 seconds (only during active calls)
setInterval(async () => {
  const timestamp = new Date().toISOString();
  console.log(`\n⏰ [${timestamp}] Copilot interval check:`);
  console.log(`   📞 Conference active: ${currentConference ? 'YES' : 'NO'} (${currentConference})`);
  console.log(`   📝 Transcript entries: ${currentTranscript.length}`);
  
  if (currentConference === null) {
    console.log('   ❌ Skipping - no active conference call');
    return;
  }

  if (currentTranscript.length === 0) {
    console.log('   ❌ Skipping - no new transcript to send');
    return;
  }

  try {
    const requestPayload = {
      lead_id: LEAD_ID,
      transcript: currentTranscript,
    };

    console.log(`\n📤 [${timestamp}] SENDING TO COPILOT:`);
    console.log(`   🎯 URL: ${COPILOT_URL}`);
    console.log(`   👤 Lead ID: ${LEAD_ID}`);
    console.log(`   📋 Transcript entries: ${currentTranscript.length}`);
    console.log(`   📄 Request payload:`, JSON.stringify(requestPayload, null, 2));
    
    const startTime = Date.now();
    
    const response = await axios.post(COPILOT_URL, requestPayload, {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'CallCopilot/1.0'
      },
      timeout: 10000, // 10 second timeout
      validateStatus: function (status) {
        return status < 500; // Resolve only if the status code is less than 500
      }
    });

    const requestTime = Date.now() - startTime;
    
    console.log(`\n✅ [${timestamp}] COPILOT RESPONSE RECEIVED (${requestTime}ms):`);
    console.log(`   📊 Status: ${response.status} ${response.statusText}`);
    console.log(`   📦 Response data:`, JSON.stringify(response.data, null, 2));

    if (response.status >= 400) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    // Validate response structure
    if (!response.data) {
      throw new Error('Empty response data from copilot');
    }

    console.log(`\n🤖 COPILOT ANALYSIS:`);
    console.log(`   💬 Advice: ${response.data.advice ? 'YES' : 'NO'} (${response.data.advice?.length || 0} chars)`);
    console.log(`   🛍️ Products: ${response.data.products ? 'YES' : 'NO'} (${response.data.products?.length || 0} chars)`);
    console.log(`   ⏱️ Advice time: ${response.data.advice_time || 'N/A'}s`);
    console.log(`   ⏱️ Overall time: ${response.data.overall_time || 'N/A'}s`);

    // Store the entire copilot response as current suggestion
    currentSuggestions = [response.data];
    console.log(`   💾 Stored ${currentSuggestions.length} suggestion(s)`);

    // Broadcast to all connected suggestion clients immediately
    broadcastSuggestion(response.data);

    // Clear transcript after successful sending
    const clearedCount = currentTranscript.length;
    currentTranscript = [];
    console.log(`   🧹 Cleared ${clearedCount} transcript entries`);
    console.log(`✅ Copilot cycle completed successfully\n`);

  } catch (error) {
    const errorTime = new Date().toISOString();
    console.log(`\n❌ [${errorTime}] COPILOT REQUEST FAILED:`);
    
    if (error.code) {
      console.log(`   🔌 Connection error: ${error.code}`);
    }
    
    if (error.response) {
      console.log(`   📊 HTTP Status: ${error.response.status} ${error.response.statusText}`);
      console.log(`   📦 Response data:`, error.response.data);
      console.log(`   🔗 Request URL: ${error.response.config?.url}`);
      console.log(`   📋 Request headers:`, error.response.config?.headers);
    } else if (error.request) {
      console.log(`   🌐 Network error - no response received`);
      console.log(`   🔗 Request URL: ${error.config?.url}`);
      console.log(`   ⏰ Timeout: ${error.config?.timeout}ms`);
    } else {
      console.log(`   ⚠️ Setup error: ${error.message}`);
    }
    
    console.log(`   📝 Transcript entries preserved: ${currentTranscript.length}`);
    console.log(`   🔄 Will retry in next interval (10s)`);
    console.log(`❌ Copilot cycle failed\n`);
  }
}, 10000); // Every 10 seconds

// ❌ Removed unnecessary /copilot endpoint - we only call external copilot service

// 🆕 WebSocket Server for suggestions
const suggestionWss = new WebSocket.Server({ port: SUGGESTION_WS_PORT });
console.log(`💡 Suggestion WebSocket running on ws://localhost:${SUGGESTION_WS_PORT}`);

// 🆕 Display cloud tunnel URL if available
if (SUGGESTION_WS_URL) {
  console.log(`🌐 Public Suggestion WebSocket URL: ${SUGGESTION_WS_URL}`);
  console.log(`📤 Share this URL for external connections: ${SUGGESTION_WS_URL}`);
} else {
  console.log(`⚠️  No SUGGESTION_WS_URL set in environment variables`);
}

suggestionWss.on('connection', (ws) => {
  console.log('🎯 Suggestion client connected');
  suggestionClients.push(ws);

  let intervalId;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.action === 'start') {
        console.log('🚀 Client requested to start receiving suggestions');
        
        // Send current suggestions immediately if available
        if (currentSuggestions.length > 0) {
          ws.send(JSON.stringify({ suggestion: currentSuggestions[0] }));
          console.log('📨 Sent current suggestion to new client');
        }
        
        // Start interval to send new suggestions every 5 seconds
        intervalId = setInterval(() => {
          if (currentSuggestions.length > 0) {
            const suggestionToSend = currentSuggestions[0]; // Always send the latest
            ws.send(JSON.stringify({ suggestion: suggestionToSend }));
            console.log(`📤 Sent latest suggestion to client`);
          } else {
            console.log('💭 No suggestions available to send');
          }
        }, 5000); // Every 5 seconds
      }
    } catch (err) {
      console.error('❌ Suggestion WS message error:', err);
    }
  });

  ws.on('close', () => {
    console.log('👋 Suggestion client disconnected');
    if (intervalId) {
      clearInterval(intervalId);
    }
    suggestionClients = suggestionClients.filter(client => client !== ws);
  });

  ws.on('error', (err) => {
    console.error('❌ Suggestion WS error:', err);
    if (intervalId) {
      clearInterval(intervalId);
    }
  });
});

// 🆕 Broadcast new suggestions to all connected clients
function broadcastSuggestion(suggestion) {
  const message = JSON.stringify({ suggestion });
  const activeClients = suggestionClients.filter(client => client.readyState === WebSocket.OPEN);
  
  activeClients.forEach(client => {
    try {
      client.send(message);
    } catch (error) {
      console.error('❌ Failed to send to client:', error.message);
    }
  });
  
  console.log(`📡 Broadcasted suggestion to ${activeClients.length}/${suggestionClients.length} clients`);
  
  // Clean up closed connections
  suggestionClients = activeClients;
}

// 🆕 Get connection info endpoint
app.get('/connection-info', (req, res) => {
  res.json({
    server_time: new Date().toISOString(),
    conference_active: currentConference !== null,
    current_conference: currentConference,
    local_suggestion_ws: `ws://localhost:${SUGGESTION_WS_PORT}`,
    public_suggestion_ws: SUGGESTION_WS_URL || 'Not configured',
    current_suggestions: currentSuggestions.length,
    current_transcript_items: currentTranscript.length,
    connected_clients: suggestionClients.length,
    copilot_config: {
      url: COPILOT_URL,
      lead_id: LEAD_ID
    },
    instructions: {
      connect: `Connect to: ${SUGGESTION_WS_URL || `ws://localhost:${SUGGESTION_WS_PORT}`}`,
      start_listening: 'Send: {"action": "start"}',
      message_format: 'Receive: {"suggestion": {...}}',
      external_copilot: COPILOT_URL
    }
  });
});

// 🆕 Get current transcript endpoint
app.get('/transcript', (req, res) => {
  res.json({
    current_transcript: currentTranscript,
    transcript_count: currentTranscript.length,
    conference_active: currentConference !== null,
    current_conference: currentConference,
    last_updated: currentTranscript.length > 0 ? new Date().toISOString() : 'No data',
    server_time: new Date().toISOString()
  });
});

// 🆕 Test copilot connection endpoint
app.get('/test-copilot', async (req, res) => {
  try {
    console.log('🧪 Testing copilot connection...');
    
    const testPayload = {
      lead_id: LEAD_ID,
      transcript: [
        { role: 'call', message: 'Hello, this is a test transcript' }
      ]
    };
    
    const response = await axios.post(COPILOT_URL, testPayload, {
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'CallCopilot-Test/1.0'
      },
      timeout: 10000
    });
    
    res.json({
      success: true,
      copilot_url: COPILOT_URL,
      status: response.status,
      response_data: response.data,
      test_payload: testPayload
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      copilot_url: COPILOT_URL,
      error: error.message,
      response_status: error.response?.status,
      response_data: error.response?.data
    });
  }
});

// 📞 Trigger all calls into conference (unchanged)
app.post('/start-call', async (req, res) => {
  try {
    const conferenceName = `Conf-${Date.now()}`;
    currentConference = conferenceName;

    console.log(`\n📞 STARTING CALL:`);
    console.log(`   🏷️ Conference: ${conferenceName}`);
    console.log(`   📱 Calling: ${jothPhone}`);
    console.log(`   📞 From: ${twilioNumber}`);

    // Speaker 1: Jothi
    await client.calls.create({
      to: jothPhone,
      from: twilioNumber,
      twiml: `<Response>
        <Start>
          <Stream url="${mediaStreamWsUrl}" />
        </Start>
        <Dial>
          <Conference>${conferenceName}</Conference>
        </Dial>
      </Response>`
    });

    console.log(`✅ Call initiated successfully`);
    
    res.json({ 
      success: true, 
      conference: conferenceName,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Call initiation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 SERVER STARTED:`);
  console.log(`   📍 Express server: http://localhost:${PORT}`);
  console.log(`   📡 Twilio Media Stream WS: ws://localhost:${WS_PORT}`);
  console.log(`   💡 Suggestion WebSocket: ws://localhost:${SUGGESTION_WS_PORT}`);
  console.log(`   📊 Connection info: http://localhost:${PORT}/connection-info`);
  console.log(`   🧪 Test copilot: http://localhost:${PORT}/test-copilot`);
  console.log(`   🔄 External Copilot URL: ${COPILOT_URL}`);
  console.log(`   👤 Lead ID: ${LEAD_ID}`);
  console.log(`\n⏰ Will auto-send transcripts to external copilot every 10 seconds during active calls`);
});