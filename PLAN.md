# Create agent-powered web app with feedback support using Claude Code

## Goal
Your goal is to help me create a custom web application that is a React web app with a chat UI to talk with a conversational agent that is authored and hosted on UiPath coded app platform. The chat UI should integrate feedback API for chat bot response.

## The conversational agent
This agent should behave like a recruiter for an AI company called OpenArrrI and he talks like a pirate. It should have a unique name like <FeedbackPirate434> - ensure its name is unique. 

## The frontend

Tech Stack: React 18 web app, vite, typescript, npm

The UX should approximate a virtual job recruiting booth where the recruiting agent would casually discuss, assess the candidate and share info about the AI company OpenArrrI. Please make up info about this company and write the info into the system prompt.

Here are some key UX features that we need to implement:
 - use External Applications auth from UiPath Platform, specifically PKCE flow, so no backend is needed for the redirect.
 - on session start, we should send an invisible message to the conversational agent to elicit a "hello / introduction" message to the user. So from the user's point of view, the agent speaks first.
 - before agent response starts to stream, show an animated typing indicator
 - any tool use event or context grounding query would create a special message block showing what tool is being run, tool parameters and when available, tool results
 - under each agent response, on hover, show the thumbs up and thumbs down icon. This should be connected to the Feedback API from AITL Automation Ops.

## Deploy as UiPath Coded App
I want to host this app and make it accessible online. Ask me to confirm that the app works locally on dev server, then deploy the app as a hosted UiPath Coded App.
