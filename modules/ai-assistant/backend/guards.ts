// Input guards for the reader-triggered Q&A endpoint.
// Injection-style prompts are refused and logged; nothing else here touches the model.
const INJECTION_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /system\s*prompt/i, reason: "试图提取系统提示词" },
  { re: /系统提示词|系统指令/, reason: "试图提取系统提示词" },
  { re: /忽略.*(指令|指示|之前)/, reason: "试图覆盖指令" },
  { re: /ignore\s+.*instructions/i, reason: "试图覆盖指令" },
  { re: /越狱|jailbreak/i, reason: "越狱尝试" },
  { re: /(扮演|假装).{0,12}(系统|管理员|开发者|无限制|没有限制)/, reason: "试图角色冒充" },
  { re: /pretend\s+to\s+be/i, reason: "试图角色冒充" },
  { re: /(泄露|透露|输出).{0,8}(提示词|指令|密钥)/, reason: "试图提取内部信息" },
  { re: /(提示词|指令|密钥|系统提示).{0,10}(泄露|透露|告诉我|给我|输出|查看)/, reason: "试图提取内部信息" },
  { re: /reveal\s+your\s+(prompt|instructions)/i, reason: "试图提取内部信息" },
  { re: /danjailbreak|do\s+anything\s+now/i, reason: "越狱尝试" },
];

/** Returns the refusal reason, or null when the question passes. */
export function checkInjection(question: string): string | null {
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(question)) return p.reason;
  }
  return null;
}

/** Refusal text shown to the reader (no lecture, no internals). */
export function refusalText(reason: string): string {
  return `该问题无法回答（${reason}）。请换一个与财经新闻相关的问题。`;
}
