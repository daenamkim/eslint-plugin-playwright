import { Rule } from 'eslint';
import * as ESTree from 'estree';
import {
  findParent,
  getParent,
  getStringValue,
  isIdentifier,
  isStringNode,
  StringNode,
} from './ast';

const testHooks = new Set(['afterAll', 'afterEach', 'beforeAll', 'beforeEach']);

const VALID_CHAINS = new Set([
  // Hooks
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
  'test.afterAll',
  'test.afterEach',
  'test.beforeAll',
  'test.beforeEach',
  // Describe
  'describe',
  'describe.only',
  'describe.skip',
  'describe.fixme',
  'describe.fixme.only',
  'describe.configure',
  'describe.serial',
  'describe.serial.only',
  'describe.serial.skip',
  'describe.serial.fixme',
  'describe.serial.fixme.only',
  'describe.parallel',
  'describe.parallel.only',
  'describe.parallel.skip',
  'describe.parallel.fixme',
  'describe.parallel.fixme.only',
  'test.describe',
  'test.describe.only',
  'test.describe.skip',
  'test.describe.fixme',
  'test.describe.fixme.only',
  'test.describe.configure',
  'test.describe.serial',
  'test.describe.serial.only',
  'test.describe.serial.skip',
  'test.describe.serial.fixme',
  'test.describe.serial.fixme.only',
  'test.describe.parallel',
  'test.describe.parallel.only',
  'test.describe.parallel.skip',
  'test.describe.parallel.fixme',
  'test.describe.parallel.fixme.only',
  // Test
  'test',
  'test.fail',
  'test.fixme',
  'test.only',
  'test.skip',
  'test.step',
  'test.slow',
  'test.use',
]);

export type AccessorNode = StringNode | ESTree.Identifier;

const joinChains = (
  a: AccessorNode[] | null,
  b: AccessorNode[] | null,
): AccessorNode[] | null => (a && b ? [...a, ...b] : null);

/**
 * Checks if the given `node` is a "supported accessor".
 *
 * This means that it's a node can be used to access properties, and who's
 * "value" can be statically determined.
 *
 * `MemberExpression` nodes most commonly contain accessors, but it's possible
 * for other nodes to contain them.
 *
 * If a `value` is provided & the `node` is an `AccessorNode`, the `value` will
 * be compared to that of the `AccessorNode`.
 *
 * Note that `value` here refers to the normalised value. The property that
 * holds the value is not always called `name`.
 */
export const isSupportedAccessor = (
  node: ESTree.Node,
  value?: string,
): node is AccessorNode =>
  isIdentifier(node, value) || isStringNode(node, value);

function getNodeChain(node: ESTree.Node): AccessorNode[] | null {
  if (isSupportedAccessor(node)) {
    return [node];
  }

  switch (node.type) {
    case 'TaggedTemplateExpression':
      return getNodeChain(node.tag);
    case 'MemberExpression':
      return joinChains(getNodeChain(node.object), getNodeChain(node.property));
    case 'CallExpression':
      return getNodeChain(node.callee);
  }

  return null;
}

const resolvePossibleAliasedGlobal = (
  context: Rule.RuleContext,
  global: string,
) => {
  const globalAliases: Record<string, string[]> =
    context.settings.playwright?.globalAliases ?? {};

  const alias = Object.entries(globalAliases).find(([, aliases]) =>
    aliases.includes(global),
  );

  return alias?.[0] ?? null;
};

interface ResolvedFn {
  local: string;
  original: string | null;
}

const resolveToPlaywrightFn = (
  context: Rule.RuleContext,
  accessor: AccessorNode,
): ResolvedFn | null => {
  const ident = getStringValue(accessor);
  const resolved = /(^expect|Expect)$/.test(ident) ? 'expect' : ident;

  return {
    // eslint-disable-next-line sort/object-properties
    original: resolvePossibleAliasedGlobal(context, resolved),
    local: resolved,
  };
};

export type FnType =
  | 'describe'
  | 'expect'
  | 'hook'
  | 'step'
  | 'test'
  | 'unknown';

function determinePlaywrightFnType(name: string): FnType {
  if (name === 'step') return 'step';
  if (name === 'expect') return 'expect';
  if (name === 'describe') return 'describe';
  if (name === 'test') return 'test';
  if (testHooks.has(name)) return 'hook';
  return 'unknown';
}

export const modifiers = new Set(['not', 'resolves', 'rejects']);

const findModifiersAndMatcher = (
  members: KnownMemberExpressionProperty[],
): ModifiersAndMatcher | string => {
  const modifiers: KnownMemberExpressionProperty[] = [];

  for (const member of members) {
    // Otherwise, it should be a modifier
    const name = getStringValue(member);

    if (name === 'soft' || name === 'poll') {
      // soft and poll must be the first modifier
      if (modifiers.length > 0) {
        return 'modifier-unknown';
      }
    } else if (name === 'resolves' || name === 'rejects') {
      const lastModifier = getStringValue(modifiers.at(-1));

      // resolves and rejects must be the first modifier following soft or poll
      if (lastModifier && lastModifier !== 'soft' && lastModifier !== 'poll') {
        return 'modifier-unknown';
      }
    } else if (name !== 'not') {
      // Check if the member is being called, which means it is the matcher
      // (and also the end of the entire "expect" call chain).
      if (
        member.parent?.type === 'MemberExpression' &&
        member.parent.parent?.type === 'CallExpression'
      ) {
        return {
          matcher: member,
          matcherArgs: member.parent.parent.arguments,
          matcherName: name,
          modifiers,
        };
      }

      // not is the only other allowed modifier
      return 'modifier-unknown';
    }

    modifiers.push(member);
  }

  // This will only really happen if there are no members
  return 'matcher-not-found';
};

function getExpectArguments(
  call: Omit<ParsedFnCall, 'type'>,
): ESTree.CallExpression['arguments'] {
  return findParent(call.head.node, 'CallExpression')?.arguments ?? [];
}

type KnownMemberExpression = ESTree.MemberExpression & {
  parent: ESTree.CallExpression;
};

type KnownMemberExpressionProperty = AccessorNode & {
  parent: KnownMemberExpression;
};

export interface ResolvedFnWithNode extends ResolvedFn {
  node: AccessorNode;
}

interface BaseParsedFnCall {
  head: ResolvedFnWithNode;
  members: KnownMemberExpressionProperty[];
  /**
   * The name of the underlying Playwright function that is being called. This
   * is the result of `(head.original ?? head.local)`.
   */
  name: string;
  type: FnType;
}

interface ParsedGeneralFnCall extends BaseParsedFnCall {
  type: Exclude<FnType, 'expect'>;
}

interface ModifiersAndMatcher {
  matcher: KnownMemberExpressionProperty;
  matcherArgs: ESTree.CallExpression['arguments'];
  matcherName: string;
  modifiers: KnownMemberExpressionProperty[];
}

export interface ParsedExpectFnCall
  extends BaseParsedFnCall,
    ModifiersAndMatcher {
  args: ESTree.CallExpression['arguments'];
  type: 'expect';
}

export type ParsedFnCall = ParsedGeneralFnCall | ParsedExpectFnCall;

const parseExpectCall = (
  call: Omit<ParsedFnCall, 'type'>,
): ParsedExpectFnCall | string => {
  const modifiersAndMatcher = findModifiersAndMatcher(call.members);

  if (typeof modifiersAndMatcher === 'string') {
    return modifiersAndMatcher;
  }

  return {
    ...call,
    args: getExpectArguments(call),
    type: 'expect',
    ...modifiersAndMatcher,
  };
};

export const findTopMostCallExpression = (
  node: ESTree.CallExpression,
): ESTree.CallExpression & Rule.NodeParentExtension => {
  let top = node;
  let parent = getParent(node);
  let child: ESTree.Node = node;

  while (parent) {
    // If the parent is a call expression, then we set that as the new top-most
    // call expression and continue up the chain. We have to verify though that
    // the child is the callee of the parent call expression and not an argument
    // as this is valid: `expect(x).not.resolves.toBe(x)`, but this is not:
    // `something(expect(x).not.resolves.toBe)`.
    if (parent.type === 'CallExpression' && parent.callee === child) {
      top = parent;
      node = parent;
      parent = getParent(parent);
      continue;
    }

    if (parent.type !== 'MemberExpression') {
      break;
    }

    child = parent;
    parent = getParent(parent);
  }

  return top as ESTree.CallExpression & Rule.NodeParentExtension;
};

function parse(context: Rule.RuleContext, node: ESTree.CallExpression) {
  const chain = getNodeChain(node);

  if (!chain?.length) {
    return null;
  }

  const [first, ...rest] = chain;
  const resolved = resolveToPlaywrightFn(context, first);
  if (!resolved) return null;

  let name = resolved.original ?? resolved.local;
  const links = [name, ...rest.map((link) => getStringValue(link))];

  if (name !== 'expect' && !VALID_CHAINS.has(links.join('.'))) {
    return null;
  }

  // To support Playwright's convention of `test.describe`, `test.beforeEach`,
  // etc. we need to test the second link in the chain to find the true type.
  if (name === 'test' && links.length > 1) {
    const nextLinkName = links[1];
    const nextLinkType = determinePlaywrightFnType(nextLinkName);

    if (nextLinkType !== 'unknown') {
      name = nextLinkName;
    }
  }

  const parsedFnCall: Omit<ParsedFnCall, 'type'> = {
    head: { ...resolved, node: first },
    // every member node must have a member expression as their parent
    // in order to be part of the call chain we're parsing
    members: rest as KnownMemberExpressionProperty[],
    name,
  };

  const type = determinePlaywrightFnType(name);

  if (type === 'expect') {
    const result = parseExpectCall(parsedFnCall);

    // If the `expect` call chain is not valid, only report on the topmost node
    // since all members in the chain are likely to get flagged for some reason
    if (
      typeof result === 'string' &&
      findTopMostCallExpression(node) !== node
    ) {
      return null;
    }

    if (result === 'matcher-not-found') {
      if (getParent(node)?.type === 'MemberExpression') {
        return 'matcher-not-called';
      }
    }

    return result;
  }

  // Check that every link in the chain except the last is a member expression
  if (
    chain
      .slice(0, chain.length - 1)
      .some((n) => getParent(n)?.type !== 'MemberExpression')
  ) {
    return null;
  }

  // Ensure that we're at the "top" of the function call chain otherwise when
  // parsing e.g. x().y.z(), we'll incorrectly find & parse "x()" even though
  // the full chain is not a valid Playwright function call chain
  const parent = getParent(node);
  if (
    parent?.type === 'CallExpression' ||
    parent?.type === 'MemberExpression'
  ) {
    return null;
  }

  return { ...parsedFnCall, type };
}

const cache = new WeakMap<
  ESTree.CallExpression,
  ParsedFnCall | string | null
>();

export function parseFnCallWithReason(
  context: Rule.RuleContext,
  node: ESTree.CallExpression,
): ParsedFnCall | string | null {
  if (cache.has(node)) {
    return cache.get(node)!;
  }

  const call = parse(context, node);
  cache.set(node, call);

  return call;
}

export function parseFnCall(
  context: Rule.RuleContext,
  node: ESTree.CallExpression,
): ParsedFnCall | null {
  const call = parseFnCallWithReason(context, node);
  return typeof call === 'string' ? null : call;
}

export const isTypeOfFnCall = (
  context: Rule.RuleContext,
  node: ESTree.CallExpression,
  types: FnType[],
): boolean => {
  const call = parseFnCall(context, node);
  return call !== null && types.includes(call.type);
};
