# Workspace-Specific AI Agent Rules for Radja Bekam

The following rules MUST be obeyed by all AI agents operating in this workspace.

<!-- BEGIN:commission-system-rules -->
## TERAPI COMMISSION SYSTEM PROTOCOL (CRITICAL FATAL RULE)
The system used to calculate therapist commissions is extremely sensitive. A previous bug caused fatal miscalculations because the logic was duplicated and inconsistent across different files. 

To guarantee this never happens again, you are STRICTLY FORBIDDEN from calculating therapist commissions manually in any route, component, or file.

**RULE 1: Single Source of Truth**
If you need to calculate a therapist's commission, you MUST use the `calculateTherapistCommission` function from `src/lib/commission.ts`. 

**RULE 2: Do Not Re-implement Hierarchy**
The hierarchy (1. Override, 2. Global, 3. Flat Rate) is already handled inside `src/lib/commission.ts`. Do not write `if/else` statements for this hierarchy anywhere else.

**RULE 3: Test Passing is Mandatory**
If you are asked to modify the commission logic in `src/lib/commission.ts`, you MUST run `npx tsx tests/commission.test.ts` and ensure all tests pass. If you add a new edge case, you MUST add a new test case for it.
<!-- END:commission-system-rules -->
