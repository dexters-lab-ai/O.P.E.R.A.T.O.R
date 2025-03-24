import { VisionProcessor } from '@open-cuak/vision';

// Enhanced element detection with computer vision
async function findElementByImage(screenshot, template, options = {}) {
  const vision = new VisionProcessor();
  await vision.initialize();
  
  const result = await vision.findTemplate(screenshot, template, {
    threshold: options.threshold || 0.8,
    multiple: options.multiple || false
  });

  await vision.cleanup();
  return result;
}

// Convert coordinates to screen positions
function convertCoordinates(coordinates, screenDimensions) {
  return {
    x: Math.round(coordinates.x * screenDimensions.width),
    y: Math.round(coordinates.y * screenDimensions.height)
  };
}

// Smart element detection combining multiple approaches
async function findElementSmart(page, selector, options = {}) {
  // Try traditional selectors first
  try {
    const element = await page.$(selector);
    if (element) return element;
  } catch (e) {
    console.log('Traditional selector failed, trying vision-based approach');
  }

  // Try vision-based approach
  const screenshot = await page.screenshot();
  const vision = new VisionProcessor();
  await vision.initialize();

  try {
    // Use OCR to find text
    const textElements = await vision.findText(screenshot, selector);
    if (textElements.length > 0) {
      const coords = convertCoordinates(textElements[0], await page.viewport());
      await vision.cleanup();
      return coords;
    }

    // Use template matching if text search fails
    if (options.templateImage) {
      const template = await vision.loadImage(options.templateImage);
      const match = await vision.findTemplate(screenshot, template);
      if (match) {
        const coords = convertCoordinates(match, await page.viewport());
        await vision.cleanup();
        return coords;
      }
    }
  } finally {
    await vision.cleanup();
  }

  throw new Error(`Element not found: ${selector}`);
}

// Intelligent action retry with multiple approaches
async function retryAction(action, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const delay = options.delay || 1000;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Try alternative approaches on subsequent attempts
      if (attempt > 1 && options.alternativeAction) {
        try {
          return await options.alternativeAction();
        } catch (altError) {
          console.log('Alternative action failed, continuing with primary approach');
        }
      }
    }
  }
}

module.exports = {
  findElementByImage,
  convertCoordinates,
  findElementSmart,
  retryAction
};