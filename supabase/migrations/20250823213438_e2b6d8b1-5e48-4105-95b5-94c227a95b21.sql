-- Add mode field to ai_agents table with constraint
ALTER TABLE public.ai_agents 
ADD COLUMN mode text NOT NULL DEFAULT 'simulation';

-- Add constraint to ensure only valid modes
ALTER TABLE public.ai_agents 
ADD CONSTRAINT ai_agents_mode_check 
CHECK (mode IN ('simulation', 'live'));