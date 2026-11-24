import {parse, TYPE} from '@formatjs/icu-messageformat-parser';

function localeRules(locale) {
  if (typeof locale !== 'string' || Intl.PluralRules.supportedLocalesOf([locale]).length !== 1) {
    throw new Error(`unsupported locale: ${locale}`);
  }
  return Object.fromEntries(['cardinal', 'ordinal'].map(type => [
    type, new Set(new Intl.PluralRules(locale, {type}).resolvedOptions().pluralCategories)
  ]));
}

function formatRole(node) {
  const kind = TYPE[node.type];
  if (node.type !== TYPE.number || !node.style) return kind;
  if (typeof node.style === 'string') return `number:${node.style}`;
  const options = Object.entries(node.style.parsedOptions).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `number:${JSON.stringify(Object.fromEntries(options))}`;
}

function scope(nodes, rules) {
  const values = new Map();
  const choices = new Map();
  let pound = false;
  for (const node of nodes) {
    if (node.type === TYPE.literal) continue;
    if (node.type === TYPE.tag) throw new Error('rich-text tags require a component contract');
    if (node.type === TYPE.pound) {
      pound = true;
      continue;
    }
    if (node.type !== TYPE.select && node.type !== TYPE.plural) {
      if (!values.has(node.value)) values.set(node.value, new Set());
      values.get(node.value).add(formatRole(node));
      continue;
    }
    if (choices.has(node.value)) throw new Error(`repeated selector in the same branch: ${node.value}`);
    const kind = node.type === TYPE.select ? 'select' : node.pluralType;
    const branches = new Map();
    for (const [label, child] of Object.entries(node.options)) {
      if (kind !== 'select' && !label.startsWith('=') && !rules[kind].has(label)) {
        throw new Error(`plural category ${label} is unavailable for this locale (${kind})`);
      }
      branches.set(label, scope(child.value, rules));
    }
    choices.set(node.value, {kind, offset: node.offset ?? 0, branches});
  }
  return {values, choices, pound};
}

function compile(catalog, locale) {
  const rules = localeRules(locale);
  if (!catalog || Array.isArray(catalog) || typeof catalog !== 'object') {
    throw new Error('catalog must be a JSON object mapping IDs to message strings');
  }
  const result = new Map();
  for (const [id, message] of Object.entries(catalog)) {
    try {
      if (typeof message !== 'string') throw new Error('expected a message string');
      result.set(id, scope(parse(message, {requiresOtherClause: true}), rules));
    } catch (error) {
      throw new Error(`${locale} message ${JSON.stringify(id)}: ${error.message}`);
    }
  }
  return result;
}

function keys(left, right) {
  return [...new Set([...left.keys(), ...right.keys()])].sort();
}

function compareScope(source, target, branch, emit) {
  for (const argument of keys(source.values, target.values)) {
    const expected = [...(source.values.get(argument) ?? [])].sort();
    const actual = [...(target.values.get(argument) ?? [])].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      emit({code: 'argument-format', branch, argument, expected, actual});
    }
  }
  if (source.pound !== target.pound) {
    emit({code: 'plural-number', branch, expected: source.pound, actual: target.pound});
  }
  for (const argument of keys(source.choices, target.choices)) {
    const left = source.choices.get(argument);
    const right = target.choices.get(argument);
    if (left?.kind !== right?.kind) {
      emit({code: 'selector-kind', branch, argument, expected: left?.kind ?? null, actual: right?.kind ?? null});
      continue;
    }
    if (left.offset !== right.offset) {
      emit({code: 'plural-offset', branch, argument, expected: left.offset, actual: right.offset});
    }
    for (const label of keys(left.branches, right.branches)) {
      const path = [...branch, {argument, label}];
      const targetArm = right.branches.get(label);
      let sourceArm = left.branches.get(label);
      if (left.kind === 'select' || label.startsWith('=')) {
        if (!sourceArm || !targetArm) {
          emit({code: sourceArm ? 'missing-branch' : 'extra-branch', branch: path});
          continue;
        }
      } else {
        // A translation may omit grammatical categories or introduce its own.
        if (!targetArm) continue;
        sourceArm ??= left.branches.get('other');
      }
      compareScope(sourceArm, targetArm, path, emit);
    }
  }
}

export function compareCatalogs(sourceCatalog, sourceLocale, targetCatalog, targetLocale) {
  const source = compile(sourceCatalog, sourceLocale);
  const target = compile(targetCatalog, targetLocale);
  const findings = [];
  for (const id of keys(source, target)) {
    if (!source.has(id) || !target.has(id)) {
      findings.push({id, code: source.has(id) ? 'missing-message' : 'extra-message'});
      continue;
    }
    compareScope(source.get(id), target.get(id), [], issue => findings.push({id, ...issue}));
  }
  return {sourceLocale, targetLocale, checked: source.size, findings};
}
