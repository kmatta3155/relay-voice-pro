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

  // Build enhanced salon-specific system prompt with better conversational guidelines
  const systemPrompt = buildSalonSpecificPrompt(businessName, knowledgeContext, businessHours, services, customInstructions);

  // Build conversation history for context
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: callerQuestion }
  ];

  // Use actual OpenAI API for intelligent responses
  return await generateIntelligentResponse(messages, callerQuestion, knowledgeContext, businessName);
}

/**
 * Build salon-specific system prompt with enhanced conversational guidelines
 */
function buildSalonSpecificPrompt(
  businessName: string,
  knowledgeContext: string,
  businessHours: string,
  services: string[],
  customInstructions: string
): string {
  return `You are the expert AI receptionist for ${businessName}, a professional salon and beauty establishment. You have deep knowledge of hair and beauty services and excel at customer service.

SALON EXPERTISE:
You understand all hair services (cuts, color, styling, treatments), beauty services (facials, lashes, brows, nails), and salon operations. You know typical service durations, maintenance schedules, and industry best practices.

BUSINESS KNOWLEDGE:
${knowledgeContext}

BUSINESS HOURS: ${businessHours}
SERVICES WE OFFER: ${services.join(", ")}

CONVERSATIONAL GUIDELINES FOR SALON CUSTOMERS:
✅ ALWAYS engage naturally - never say "I don't have enough information"
✅ Use your salon expertise to provide helpful responses even when specifics aren't available
✅ For hours questions: If specific hours are in the knowledge base, provide them. If not, give helpful guidance like "We're typically open weekdays and weekends, let me have someone confirm our exact hours for you today"
✅ Ask follow-up questions to understand customer needs better
✅ Suggest complementary services when appropriate
✅ Be enthusiastic about beauty and helping clients look their best
✅ Handle requests gracefully by offering alternatives and solutions
✅ Keep responses natural, warm, and conversational (1-2 sentences ideal)
✅ NEVER go silent - always provide a helpful response

EXAMPLE SALON RESPONSES:
• "What hours are you open?" → "We're open most days of the week! Let me have someone confirm our exact schedule for today and call you right back. Are you looking to book an appointment?"
• "Do you do highlights?" → "Absolutely! We specialize in all types of hair coloring including highlights, balayage, and color correction. What look are you hoping to achieve?"
• "I need my roots done" → "Perfect timing! Root touch-ups are one of our most popular services. When was your last color? I can connect you with our colorist to get you scheduled."

STRICT RULES:
- NEVER respond with just "yes" or "no" - always provide helpful context
- NEVER say you don't have information without offering an alternative
- ALWAYS sound professional yet friendly and approachable
- ALWAYS offer next steps (scheduling, consultation, call back)

${customInstructions}

Remember: You represent a professional salon, so be knowledgeable, helpful, and proactive in every response.`;
}

/**
 * Generate intelligent response using OpenAI API with salon context
 */
async function generateIntelligentResponse(
  messages: Array<{ role: string; content: string }>,
  callerQuestion: string,
  knowledgeContext: string,
  businessName: string
): Promise<string> {
  // Get OpenAI API key from environment
  const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    console.warn('OpenAI API key not found, falling back to enhanced pattern matching');
    return generateEnhancedFallbackResponse(callerQuestion, knowledgeContext, businessName);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: 150,
        temperature: 0.7,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content?.trim();

    if (!aiResponse) {
      throw new Error('Empty response from OpenAI');
    }

    return aiResponse;

  } catch (error) {
    console.error('OpenAI API call failed:', error);
    // Fallback to enhanced pattern matching if API fails
    return generateEnhancedFallbackResponse(callerQuestion, knowledgeContext, businessName);
  }
}

/**
 * Enhanced fallback response generator with salon-specific knowledge
 */
function generateEnhancedFallbackResponse(question: string, knowledge: string, businessName: string): string {
  const lowerQuestion = question.toLowerCase();
  
  // Enhanced hours handling with salon context
  if (lowerQuestion.includes('hour') || lowerQuestion.includes('open') || lowerQuestion.includes('close') || lowerQuestion.includes('time')) {
    if (knowledge.includes('Monday') || knowledge.includes('Tuesday') || knowledge.includes('AM') || knowledge.includes('PM')) {
      // Extract and provide the hours if available in knowledge
      const hoursMatch = knowledge.match(/Monday.*?Sunday.*?[0-9].*?[AP]M/i) || 
                        knowledge.match(/[0-9]{1,2}:[0-9]{2}\s*[AP]M.*?[0-9]{1,2}:[0-9]{2}\s*[AP]M/gi);
      if (hoursMatch) {
        return `Our hours are: ${hoursMatch[0]}. Would you like to schedule an appointment?`;
      }
    }
    return `We're open most days of the week! Let me have someone confirm our exact schedule for today and call you right back. Are you looking to book an appointment?`;
  }
  
  // Service-specific responses with salon expertise
  if (lowerQuestion.includes('highlights') || lowerQuestion.includes('color') || lowerQuestion.includes('dye')) {
    return `Absolutely! We specialize in all types of hair coloring including highlights, balayage, and color correction. What look are you hoping to achieve? I can connect you with our colorist!`;
  }
  
  if (lowerQuestion.includes('cut') || lowerQuestion.includes('trim') || lowerQuestion.includes('hair')) {
    return `Yes, we offer full hair services! Whether you're looking for a trim, new style, or complete makeover, our stylists can help. What kind of look are you thinking about?`;
  }
  
  if (lowerQuestion.includes('appointment') || lowerQuestion.includes('book') || lowerQuestion.includes('schedule')) {
    return `I'd love to help you schedule an appointment! What service were you interested in? I can check our availability and get you booked with the perfect stylist.`;
  }
  
  if (lowerQuestion.includes('price') || lowerQuestion.includes('cost') || lowerQuestion.includes('how much')) {
    return `I can help with pricing! Our rates vary by service and stylist. Let me have someone call you back with current pricing and any special offers we have available.`;
  }
  
  if (lowerQuestion.includes('extensions') || lowerQuestion.includes('length') || lowerQuestion.includes('volume')) {
    return `We offer several types of extensions including tape-ins, clip-ins, and fusion extensions. Are you looking to add length, volume, or both? I can connect you with our extension specialist!`;
  }
  
  // General salon services with enthusiasm  
  if (lowerQuestion.includes('service') || lowerQuestion.includes('offer') || lowerQuestion.includes('do you')) {
    return `Yes, we offer a full range of hair and beauty services! From cuts and color to styling and treatments, we've got you covered. What specific service were you interested in learning about?`;
  }
  
  // Default response with salon context
  return `Thank you for calling ${businessName}! I'd be happy to help you with that. Let me have someone from our team call you back with all the details. What's the best number to reach you at?`;
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