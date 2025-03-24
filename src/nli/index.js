// Natural Language Interface Router System
import OpenAI from 'openai';
import { QuarkAgent } from '../quark/index.js';
import logger from '../utils/logger.js';

class NLIRouter {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.quarkAgent = new QuarkAgent();
    this.sessionStore = new Map();
    
    // Command type patterns
    this.patterns = {
      systemOps: /(open|launch|start|run|close|quit)\s+([a-zA-Z0-9\s]+)/i,
      webOps: /(visit|go to|navigate|browse)\s+(https?:\/\/[^\s]+|[a-zA-Z0-9\s\.]+\.[a-z]{2,})/i,
      chatQuery: /(what|how|why|when|where|who|explain|tell|describe)/i
    };
  }

  async initialize() {
    await this.quarkAgent.initialize();
    logger.info('NLI Router initialized');
  }

  async processInput(input, sessionId, options = {}) {
    logger.info(`[NLI] Processing input: "${input}" for session ${sessionId}`);
    
    try {
      // Get or create session state
      let sessionState = this.getSessionState(sessionId);
      
      // Analyze input
      const analysisResult = await this.analyzeInput(input, sessionState);
      
      // Route to appropriate handler
      const result = await this.routeRequest(analysisResult, sessionState, options);
      
      // Update session state
      this.updateSessionState(sessionId, {
        lastInput: input,
        lastResult: result,
        timestamp: new Date()
      });

      return {
        success: true,
        result,
        sessionState
      };
    } catch (error) {
      logger.error('[NLI] Error processing input:', error);
      throw error;
    }
  }

  async analyzeInput(input, sessionState) {
    // First, check for continuation of previous conversation
    if (sessionState.lastInput && sessionState.lastResult) {
      const continuationCheck = await this.checkForContinuation(input, sessionState);
      if (continuationCheck.isContinuation) {
        return {
          type: 'continuation',
          context: continuationCheck.context,
          originalType: sessionState.lastResult.type
        };
      }
    }

    // Analyze with OpenAI
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: "Analyze the following user input and categorize it into one of these types: system_operation, web_operation, chat_query, or complex_task. Also extract key parameters and intended actions."
      }, {
        role: "user",
        content: input
      }],
      temperature: 0.1,
      max_tokens: 150
    });

    const result = JSON.parse(analysis.choices[0].message.content);

    // Enhance with pattern matching
    if (this.patterns.systemOps.test(input)) {
      result.type = 'system_operation';
    } else if (this.patterns.webOps.test(input)) {
      result.type = 'web_operation';
    } else if (this.patterns.chatQuery.test(input)) {
      result.type = 'chat_query';
    }

    return result;
  }

  async routeRequest(analysis, sessionState, options) {
    switch (analysis.type) {
      case 'system_operation':
        return await this.handleSystemOperation(analysis, options);
      
      case 'web_operation':
        return await this.handleWebOperation(analysis, options);
      
      case 'chat_query':
        return await this.handleChatQuery(analysis, options);
      
      case 'complex_task':
        return await this.handleComplexTask(analysis, sessionState, options);
      
      case 'continuation':
        return await this.handleContinuation(analysis, sessionState, options);
      
      default:
        throw new Error(`Unknown operation type: ${analysis.type}`);
    }
  }

  async handleSystemOperation(analysis, options) {
    logger.info('[NLI] Handling system operation:', analysis);
    
    const result = await this.quarkAgent.processCommand(analysis.action, {
      type: 'system',
      ...options
    });

    return {
      type: 'system_operation',
      action: analysis.action,
      result,
      timestamp: new Date()
    };
  }

  async handleWebOperation(analysis, options) {
    logger.info('[NLI] Handling web operation:', analysis);
    
    const result = await this.quarkAgent.processCommand(analysis.action, {
      type: 'web',
      url: analysis.parameters?.url,
      ...options
    });

    return {
      type: 'web_operation',
      action: analysis.action,
      result,
      timestamp: new Date()
    };
  }

  async handleChatQuery(analysis, options) {
    logger.info('[NLI] Handling chat query:', analysis);
    
    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: "You are a helpful assistant. Provide clear, concise answers."
      }, {
        role: "user",
        content: analysis.query
      }],
      ...options
    });

    return {
      type: 'chat_query',
      query: analysis.query,
      response: response.choices[0].message.content,
      timestamp: new Date()
    };
  }

  async handleComplexTask(analysis, sessionState, options) {
    logger.info('[NLI] Handling complex task:', analysis);
    
    // Break down into subtasks
    const taskPlan = await this.planComplexTask(analysis);
    
    // Execute subtasks sequentially
    const results = [];
    for (const subtask of taskPlan.subtasks) {
      const subtaskResult = await this.processInput(subtask.description, sessionState.id, {
        ...options,
        isSubtask: true,
        parentTask: analysis
      });
      results.push(subtaskResult);
      
      // Check for failure
      if (!subtaskResult.success) {
        return {
          type: 'complex_task',
          status: 'failed',
          error: `Subtask failed: ${subtask.description}`,
          results,
          timestamp: new Date()
        };
      }
    }

    return {
      type: 'complex_task',
      status: 'completed',
      plan: taskPlan,
      results,
      timestamp: new Date()
    };
  }

  async handleContinuation(analysis, sessionState, options) {
    logger.info('[NLI] Handling continuation:', analysis);
    
    // Merge with previous context
    const mergedContext = this.mergeContinuationContext(
      analysis.context,
      sessionState.lastResult
    );

    // Process as original type
    return await this.routeRequest({
      type: analysis.originalType,
      ...mergedContext
    }, sessionState, options);
  }

  async planComplexTask(analysis) {
    const planningPrompt = `Break down this complex task into sequential subtasks:
      Task: ${analysis.action}
      Context: ${JSON.stringify(analysis.parameters)}
      
      Provide output as JSON with subtasks array.`;

    const response = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: planningPrompt
      }],
      temperature: 0.2,
      max_tokens: 500
    });

    return JSON.parse(response.choices[0].message.content);
  }

  async checkForContinuation(input, sessionState) {
    const analysis = await this.openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: "Determine if this input is a continuation of the previous conversation. Consider pronouns, context references, and implicit subjects."
      }, {
        role: "user",
        content: `Previous: ${sessionState.lastInput}\nCurrent: ${input}`
      }],
      temperature: 0.1,
      max_tokens: 100
    });

    return JSON.parse(analysis.choices[0].message.content);
  }

  mergeContinuationContext(newContext, previousResult) {
    return {
      ...previousResult,
      ...newContext,
      parameters: {
        ...previousResult.parameters,
        ...newContext.parameters
      }
    };
  }

  getSessionState(sessionId) {
    if (!this.sessionStore.has(sessionId)) {
      this.sessionStore.set(sessionId, {
        id: sessionId,
        created: new Date(),
        history: []
      });
    }
    return this.sessionStore.get(sessionId);
  }

  updateSessionState(sessionId, updates) {
    const state = this.getSessionState(sessionId);
    Object.assign(state, updates);
    state.history.push({
      timestamp: new Date(),
      input: updates.lastInput,
      result: updates.lastResult
    });
    this.sessionStore.set(sessionId, state);
  }

  async cleanup() {
    await this.quarkAgent.close();
    this.sessionStore.clear();
  }
}

module.exports = NLIRouter;