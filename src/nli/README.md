# Natural Language Interface (NLI) Router System

A robust system for processing and routing natural language commands to appropriate handlers.

## Features

- Input analysis and categorization
- Session state management
- Complex task breakdown
- Conversation continuity tracking
- Comprehensive logging
- Error handling and recovery

## Command Types

1. System Operations
   - Launch applications
   - File operations
   - System controls

2. Web Operations
   - Navigation
   - Form filling
   - Data extraction

3. Chat Queries
   - Information requests
   - Explanations
   - Assistance

4. Complex Tasks
   - Multi-step operations
   - Context-dependent actions
   - State-aware processes

## Usage

```javascript
const NLIRouter = require('./nli');

async function example() {
  const router = new NLIRouter();
  await router.initialize();

  const result = await router.processInput(
    "open Chrome and go to Twitter",
    "user123",
    { screenshot: true }
  );

  console.log(result);
}
```

## Session Management

Sessions track:
- Conversation history
- Context
- State
- Results

## Error Handling

- Graceful degradation
- Automatic retry
- Detailed logging
- User feedback

## Integration

Integrates with:
- Quark automation
- OpenAI API
- System tools
- Logging system