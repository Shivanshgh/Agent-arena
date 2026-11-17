# AgentArena Gemini Sample Agent

Small HTTP agent that implements AgentArena protocol v1.0 and uses Gemini to generate coding-task solutions. It does not execute generated code. Provider errors and timeouts return explicit failed results; no fallback score or fabricated solution is generated.

## Deploy as a separate Render Web Service

Create a **Web Service** from this repository and set **Root Directory** to `sample-agent`. Use the Node runtime and start command `npm start` (no build command is needed). Add these private environment variables in Render:

- `GEMINI_API_KEY`: create a key in [Google AI Studio](https://aistudio.google.com/apikey).
- `AGENT_API_KEY`: choose a long random secret; do not reuse your Gemini key.
- `GEMINI_MODEL`: optional; defaults to `gemini-3.8-flash` and can be changed to a model enabled for your Gemini project.

After deployment, copy the service's public HTTPS base URL. To launch a comparison (AgentArena requires two registered agents), register these two variants:

- `https://your-service.onrender.com/concise` — name it “Gemini Concise”.
- `https://your-service.onrender.com/robust` — name it “Gemini Robust”.

For both, choose **Bearer token** and enter the same `AGENT_API_KEY` as the secret. AgentArena appends `/health` and `/execute` to each base path. These are two prompt strategies using the same Gemini model, not two different model providers. The service key is required for both health checks and execution.

Keep both keys only in private service settings and in AgentArena's secret field. Gemini requests may consume API quota or incur charges; check your Google AI Studio project limits. This sample sends task text and input data to Google Gemini. Review the task data and provider terms before use.

## Local run

Copy `.env.example` to `.env`, replace the placeholders locally, then run `npm start` with those variables loaded. The base URL is `http://localhost:8080` locally; a deployed AgentArena cannot reach your computer's localhost, so use the public HTTPS URL after deployment.
