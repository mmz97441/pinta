import React, { createContext, useCallback, useContext } from 'react';

const TaskAccessContext = createContext(false);

/** A colleague's active task opens for consultation. This UI guard applies to
 * this task only; database permissions and optimistic versions remain enforced. */
export function TaskAccessBoundary({ readOnly, children }) {
  return <TaskAccessContext.Provider value={Boolean(readOnly)}>{children}</TaskAccessContext.Provider>;
}

export function useTaskAccess(can) {
  const readOnly = useContext(TaskAccessContext);
  const taskCan = useCallback(permission => can(permission) && (!readOnly || permission.includes('_voir')), [can, readOnly]);
  return { readOnly, taskCan };
}
