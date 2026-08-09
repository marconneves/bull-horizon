import { JsonataFilterService } from '@/services/jsonata-filter';
import type { TFilterGroup, TFilterNode } from '@/services/jsonata-filter';

// Immutable operations over the filter tree. Kept out of the component so React
// only ever deals with fresh state, never in-place mutation.

const mapChildren = (
  group: TFilterGroup,
  fn: (child: TFilterNode) => TFilterNode | null
): TFilterGroup => ({
  ...group,
  children: group.children
    .map((child) => (child.kind === 'group' ? mapChildren(child, fn) : child))
    .map(fn)
    .filter((child): child is TFilterNode => child !== null),
});

export const TreeOps = {
  update(root: TFilterGroup, id: string, patch: Partial<TFilterNode>): TFilterGroup {
    // The root isn't anyone's child — flipping its connector lands here.
    if (root.id === id) return { ...root, ...patch } as TFilterGroup;
    return mapChildren(root, (child) =>
      child.id === id ? ({ ...child, ...patch } as TFilterNode) : child
    );
  },

  remove(root: TFilterGroup, id: string): TFilterGroup {
    const pruned = mapChildren(root, (child) => (child.id === id ? null : child));
    // A group left without children has no reason to exist.
    return mapChildren(pruned, (child) =>
      child.kind === 'group' && !child.children.length ? null : child
    );
  },

  addCondition(root: TFilterGroup, groupId: string): TFilterGroup {
    const add = (group: TFilterGroup): TFilterGroup => ({
      ...group,
      children:
        group.id === groupId
          ? [...group.children, JsonataFilterService.createCondition()]
          : group.children.map((child) =>
              child.kind === 'group' ? add(child) : child
            ),
    });
    return add(root);
  },

  addGroup(root: TFilterGroup, groupId: string): TFilterGroup {
    const add = (group: TFilterGroup): TFilterGroup => ({
      ...group,
      children:
        group.id === groupId
          ? [
              ...group.children,
              // A subgroup starts with the opposite connector: that's what
              // nesting is for (`a and (b or c)`).
              JsonataFilterService.createGroup(
                group.connector === 'and' ? 'or' : 'and'
              ),
            ]
          : group.children.map((child) =>
              child.kind === 'group' ? add(child) : child
            ),
    });
    return add(root);
  },
};
