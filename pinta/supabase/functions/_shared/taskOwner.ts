import { HttpError, throwDb } from './http.ts';

const TRANSFERRED = 'Cette tâche est suivie par un collègue. Actualisez le dossier et organisez un relais avant de corriger.';

/** Refuses a task followed by a colleague before any provider side effect. SQL checks again under lock. */
export async function assertTaskOwner(db: any, colisId: string, kinds: string[], staffId: string, message = TRANSFERRED) {
  const result = await db.from('staff_work_actions').select('assignee_id')
    .eq('colis_id', colisId).in('kind', kinds).in('state', ['ready', 'in_progress', 'waiting']);
  throwDb(result);
  if (result.data?.some((action: any) => action.assignee_id && action.assignee_id !== staffId)) {
    const error: any = new HttpError(409, message);
    error.code = '40001'; throw error;
  }
}
