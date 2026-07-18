// Warstwa weryfikacji AI.
//
// UWAGA: to jest na razie ATRAPA (mock). Docelowo `verifyText` wyśle tekst
// rozdziału wraz z notatkami autora (kompendium) do naszego serwera proxy,
// który dopiero woła Anthropic API z ukrytym kluczem. Tu zwracamy przykładowe
// dane, żeby zbudować i przetestować interfejs bez backendu.

/** Kategoria wykrytego problemu. */
export type IssueType = "grammar" | "consistency" | "logic";

/** Pojedynczy problem wykryty w tekście. */
export interface Issue {
  type: IssueType;
  /** Fragment tekstu, którego dotyczy uwaga. */
  fragment: string;
  /** Opis problemu. */
  description: string;
  /** Proponowana poprawka. */
  suggestion: string;
}

export interface VerifyResult {
  issues: Issue[];
}

export interface VerifyParams {
  /** Treść (Markdown) weryfikowanego rozdziału/dokumentu. */
  text: string;
  /** Notatki autora jako kontekst (opis świata, postacie itd.). */
  notes: { title: string; content: string }[];
}

/** Sztuczne opóźnienie, by zasymulować round-trip do serwera. */
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Weryfikuje tekst pod kątem gramatyki, spójności i logiki.
 * ATRAPA — podmień na wywołanie serwera proxy (fetch do /verify).
 */
export async function verifyText(params: VerifyParams): Promise<VerifyResult> {
  await delay(900);

  if (!params.text.trim()) {
    return { issues: [] };
  }

  // Przykładowe wyniki demonstracyjne (nie pochodzą z prawdziwej analizy).
  const demo: Issue[] = [
    {
      type: "grammar",
      fragment: "example sentence fragment",
      description: "Possible punctuation error — a missing comma before the conjunction.",
      suggestion: "Add a comma before \"which\".",
    },
    {
      type: "consistency",
      fragment: "character name",
      description: "This character was previously introduced under a different name.",
      suggestion: "Align the character's name with the \"Characters\" note.",
    },
    {
      type: "logic",
      fragment: "event description",
      description: "This event contradicts a world rule described in the notes.",
      suggestion: "Check consistency with the \"World rules\" note.",
    },
  ];

  return { issues: demo };
}
