
import { GoogleGenAI } from "@google/genai";

/**
 * Analyzes the provided base64 image data using Gemini-2.5-flash-image.
 * This can provide insights, detect objects, or suggest improvements.
 */
export async function analyzeImage(base64Data: string): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const imagePart = {
      inlineData: {
        mimeType: 'image/png',
        data: base64Data,
      },
    };

    const promptPart = {
      text: "Analyze this image and the markings on it. Provide a brief professional description of the image content and any annotations (arrows, boxes, lines) added. Suggest one creative way to improve this visual communication."
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [imagePart, promptPart] },
      config: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    return response.text || "No insights available for this image.";
  } catch (error) {
    console.error("Gemini service error:", error);
    throw error;
  }
}
