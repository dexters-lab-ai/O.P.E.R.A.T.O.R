import { QuarkAgent } from './index.js';

class QuarkPuppeteerAdapter {
  constructor() {
    this.quark = new QuarkAgent();
  }

  async initialize() {
    await this.quark.initialize();
  }

  async goto(url) {
    // Use Quark's automation to navigate
    await this.quark.processCommand(`navigate to ${url}`);
  }

  async click(selector) {
    await this.quark.click(selector);
  }

  async type(selector, text) {
    await this.quark.type(text, selector);
  }

  async waitForSelector(selector, options = {}) {
    await this.quark.waitForElement(selector, options.timeout);
  }

  async screenshot() {
    return await this.quark.captureScreen();
  }

  async evaluate(fn, ...args) {
    // Convert JavaScript function to Quark command
    const command = await this.quark.nlpProcessor.convertJsToNaturalLanguage(fn.toString());
    return await this.quark.processCommand(command, { args });
  }

  async close() {
    await this.quark.close();
  }
}

class QuarkPlaywrightAdapter {
  constructor() {
    this.quark = new QuarkAgent();
  }

  async initialize() {
    await this.quark.initialize();
  }

  async goto(url) {
    await this.quark.processCommand(`navigate to ${url}`);
  }

  async click(selector) {
    await this.quark.click(selector);
  }

  async fill(selector, text) {
    await this.quark.type(text, selector);
  }

  async waitForSelector(selector, options = {}) {
    await this.quark.waitForElement(selector, options.timeout);
  }

  async screenshot() {
    return await this.quark.captureScreen();
  }

  async evaluate(fn, ...args) {
    const command = await this.quark.nlpProcessor.convertJsToNaturalLanguage(fn.toString());
    return await this.quark.processCommand(command, { args });
  }

  async close() {
    await this.quark.close();
  }
}

module.exports = {
  QuarkPuppeteerAdapter,
  QuarkPlaywrightAdapter
};