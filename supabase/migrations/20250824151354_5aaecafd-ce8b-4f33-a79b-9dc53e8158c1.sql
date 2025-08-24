UPDATE ai_agents 
SET model = 'gpt-4o-mini' 
WHERE model = 'gpt-5-mini-2025-08-07' AND status = 'ready';