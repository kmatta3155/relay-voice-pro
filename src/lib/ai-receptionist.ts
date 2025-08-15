/**
 * AI Receptionist with RAG integration
 * Drop-in helper for generating AI responses with business knowledge
 */
import { getGroundingContext } from "@/lib/receptionist-rag";

export interface ReceptionistConfig {
  tenantId: string;
  businessName?: string;
  businessHours?: string;
  services?: string[];
  customInstructions?: string;
}

export interface CallContext {
  callerNumber: string;
  callerQuestion: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Generate a contextual AI response using the business knowledge base
 */
export async function generateReceptionistResponse(
  config: ReceptionistConfig,
  context: CallContext
): Promise<string> {
  const { tenantId, businessName = "the business", businessHours = "business hours", services = [], customInstructions = "" } = config;
  const { callerQuestion, conversationHistory = [] } = context;

  // Get relevant knowledge from the business knowledge base
  const knowledgeContext = await getGroundingContext(tenantId, callerQuestion, 6);

  // Build the system prompt with business context
  const systemPrompt = `You are the friendly AI receptionist for ${businessName}. 

BUSINESS KNOWLEDGE:
${knowledgeContext}

INSTRUCTIONS:
- Be warm, professional, and helpful
- Answer questions using ONLY the business knowledge provided above
- If you don't know something from the knowledge base, politely say you'll have someone call them back
- For appointment requests, be helpful but mention they may need to confirm availability
- Keep responses concise and natural
- Hours: ${businessHours}
- Services: ${services.join(", ")}

${customInstructions}

If the knowledge base doesn't contain relevant information, respond with: "I'd be happy to help with that! Let me have someone from our team call you back with the details. What's the best number to reach you?"`;

  // Build conversation history for context
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: callerQuestion }
  ];

  // For demo purposes, return a simple response based on common patterns
  // In production, this would call your preferred LLM API (OpenAI, Anthropic, etc.)
  return generateMockResponse(callerQuestion, knowledgeContext, businessName);
}

/**
 * Mock response generator for demonstration
 * Replace this with actual LLM API calls in production
 */
function generateMockResponse(question: string, knowledge: string, businessName: string): string {
  const lowerQuestion = question.toLowerCase();
  
  // Check if we have relevant knowledge
  if (knowledge.trim()) {
    if (lowerQuestion.includes('hour') || lowerQuestion.includes('open') || lowerQuestion.includes('close')) {
      return `Based on our current information, here are our hours. Let me have someone confirm the exact times and call you back to make sure you have the most up-to-date schedule.`;
    }
    
    if (lowerQuestion.includes('price') || lowerQuestion.includes('cost') || lowerQuestion.includes('how much')) {
      return `I can help with pricing information! Let me have one of our team members call you back with current rates and any special offers we might have available.`;
    }
    
    if (lowerQuestion.includes('appointment') || lowerQuestion.includes('book') || lowerQuestion.includes('schedule')) {
      return `I'd be happy to help you schedule an appointment! Let me connect you with someone who can check our availability and get you booked. What service were you interested in?`;
    }
    
    if (lowerQuestion.includes('service') || lowerQuestion.includes('offer') || lowerQuestion.includes('do you')) {
      return `Yes, we offer several services! Based on what I have here, it looks like we can definitely help you. Let me have someone from our team call you back with the complete details about our services.`;
    }
  }
  
  // Default response when no specific knowledge is found
  return `Thank you for calling ${businessName}! I'd be happy to help with that. Let me have someone from our team call you back with all the details. What's the best number to reach you?`;
}

/**
 * Log unanswered questions for knowledge base improvement
 */
export async function logUnansweredQuestion(
  tenantId: string, 
  question: string, 
  callId?: string
): Promise<void> {
  try {
    const { logUnanswered } = await import("@/lib/rag");
    await logUnanswered(tenantId, question, callId);
  } catch (error) {
    console.error('Failed to log unanswered question:', error);
  }
}

/**
 * Example usage:
 * 
 * const config = {
 *   tenantId: "your-tenant-id",
 *   businessName: "Auto Pro Shop",
 *   businessHours: "Mon-Fri 8AM-6PM, Sat 9AM-4PM",
 *   services: ["Oil Changes", "Brake Service", "Tire Installation"],
 *   customInstructions: "Always mention our 6-month warranty on all services."
 * };
 * 
 * const context = {
 *   callerNumber: "+1234567890",
 *   callerQuestion: "Do you do oil changes and what does it cost?"
 * };
 * 
 * const response = await generateReceptionistResponse(config, context);
 */