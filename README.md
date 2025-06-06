# 📞 Real-Time Call Transcription & AI Copilot Suggestion System

This Node.js server enables real-time audio transcription from Twilio calls using Deepgram and forwards transcribed data to an AI Copilot service for real-time sales suggestions and analysis. It features WebSocket-based client connections to receive AI-powered suggestions.

## 🔧 Features

- 📞 Start a Twilio conference call with real-time media streaming
- 🔊 Transcribe call audio using [Deepgram Nova-3 STT](https://developers.deepgram.com/)
- 🧠 Forward transcripts to a custom AI Copilot for analysis and advice
- 💬 Broadcast AI suggestions to WebSocket-connected frontends
- 🌐 Expose endpoints to test, fetch status, and monitor transcript flow

## 📁 Project Structure

- **Express Server** (port `8000`)
- **Twilio Media Stream WS** (port `8081`)
- **Suggestion WebSocket Server** (port `8082`)

## 🚀 Getting Started

### 1. Clone the Repo

```bash
git clone https://github.com/your-username/ai-call-copilot.git
cd ai-call-copilot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file based on the following template:

```env
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
JOTHPHONE=+1xxxxxxxxxx
VRAJPHONE=+1xxxxxxxxxx
LISTENER_PHONE=+1xxxxxxxxxx
MEDIA_STREAM_WS=wss://your-ngrok-url-for-media-stream
SUGGESTION_WS_URL=wss://your-ngrok-url-for-suggestion-ws
DEEPGRAM_API_KEY=your_deepgram_key
COPILOT_URL=https://your-copilot-endpoint.com/copilot
LEAD_ID=your-lead-id
```

> ✅ Use [ngrok](https://ngrok.com/) or a similar tunneling service to expose your local WebSocket servers to Twilio and external clients.

## 📡 API Endpoints

### `POST /start-call`

Trigger a call and join a Twilio conference with media streaming.

```json
{
  "success": true,
  "conference": "Conf-1717697824380",
  "timestamp": "2025-06-07T00:37:04.380Z"
}
```

### `GET /connection-info`

Get system health info, connected clients, and current transcripts.

### `GET /transcript`

View current transcript buffer for the ongoing conference.

### `GET /test-copilot`

Send a sample payload to the Copilot endpoint to verify connectivity and response.

## 📬 WebSocket Interfaces

### Twilio Media Stream WebSocket

- Accepts Twilio's raw audio via `/Start/Stream` from `<Stream url="...">`
- Forwards real-time audio to Deepgram for transcription

### Suggestion WebSocket Server

- **Port:** `8082`
- **Client Instructions:**
  - Connect to: `ws://localhost:8082` (or tunnel URL)
  - Send `{ "action": "start" }` to begin receiving suggestions
  - Receive format: `{ "suggestion": { ...copilotResponse } }`

## 🧠 Copilot Integration

Transcripts are auto-sent every 10 seconds if a conference is active. The AI response is parsed, validated, stored, and broadcast to all connected suggestion WebSocket clients.

## 🛠 Tech Stack

- **Node.js + Express** – REST API
- **WebSocket** – Bi-directional suggestion sync
- **Twilio Programmable Voice** – Audio streaming
- **Deepgram SDK** – Real-time STT
- **Axios** – Copilot HTTP communication

## 🧪 Testing Locally

1. **Start local server**
   ```bash
   node server.js
   ```

2. **Tunnel local ports (if needed)**
   ```bash
   ngrok http 8000           # Express
   ngrok http 8081           # Media WS
   ngrok http 8082           # Suggestion WS
   ```

3. **Update `.env` with ngrok URLs**

## 📈 Logs & Debugging

The app logs key events including:

- WebSocket connections
- Deepgram transcriptions
- Copilot request/response cycles
- Suggestion broadcasts and client syncs

## 👨‍💻 Author

Built by [Akshay Waghmare](https://github.com/akshayw1)

## 🪪 License

MIT License. Use freely, modify responsibly.
