Research the codebase to answer: $ARGUMENTS

Process:
1. Read any directly mentioned files FULLY before doing anything else.
2. Break down the question into research areas.
3. Use the Task tool to spawn parallel Explore agents:
   - One to find WHERE relevant files live (locator role)
   - One to understand HOW the relevant code works (analyzer role)
   - One to find EXAMPLES of similar patterns (pattern finder role)
   - One to find relevant historical docs if a docs/ directory exists
4. WAIT for all agents to complete.
5. Synthesize findings into a research document.
6. Save to docs/research/YYYY-MM-DD-[description].md

CRITICAL RULES:
- You and all subagents are DOCUMENTARIANS. Describe what IS, never what SHOULD BE.
- No improvement suggestions, no problem identification, no critiques.
- Every claim needs a file:line reference.
- Never write the document with placeholder values.
- Present a summary to the user when done.
