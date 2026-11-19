type Recognition = { text: string; confidence: number };

function textFragments(text: string) {
  const fragments = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 2) continue;
    for (let i = 0; i <= Math.max(0, word.length - 3); i++) {
      const fragment = word.slice(i, i + 3);
      fragments.set(fragment, (fragments.get(fragment) ?? 0) + 1);
    }
  }
  return fragments;
}

export function gradeSignReadability(source: Recognition, output: Recognition, wordHeight = Infinity) {
  const expected = textFragments(source.text);
  const detected = textFragments(output.text);
  if (!detected.size) return expected.size ? { grade: 'VERY LOW', score: 0 } : null;

  let expectedCount = 0;
  let matched = 0;
  for (const [fragment, count] of expected) {
    expectedCount += count;
    matched += Math.min(count, detected.get(fragment) ?? 0);
  }

  const confidence = Math.max(0, Math.min(100, output.confidence || 0));
  const estimate = expectedCount ? 70 * (matched / expectedCount) + 0.3 * confidence : confidence;
  const sizeCeiling = wordHeight < 5 ? 51 : wordHeight < 8 ? 72 : wordHeight < 11 ? 89 : 100;
  const score = Math.min(Math.round(estimate), sizeCeiling);
  let grade = 'VERY LOW';
  if (score >= 90) grade = 'VERY GOOD';
  else if (score >= 73) grade = 'GOOD';
  else if (score >= 52) grade = 'FINE';
  else if (score >= 30) grade = 'LOW';
  return { grade, score };
}

export type SignReadabilityGrade = ReturnType<typeof gradeSignReadability>;
