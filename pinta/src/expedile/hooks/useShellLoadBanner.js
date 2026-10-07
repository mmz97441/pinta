import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { holdsStaffData, shellLoadBanner, staffDataState } from '../domain/dataLoad';

/**
 * Whether the staff shell shows its load banner on this page (domain/dataLoad.js):
 * the reason of an interrupted load, with « Réessayer ». A section that failed
 * for the same outage refers to the banner instead of repeating the failure,
 * so a screen states it once, with one « Réessayer ».
 */
export default function useShellLoadBanner() {
  const { isStaff, sbReady, dataLoading, dataError, data = [], clients = [], envois = [] } = useApp();
  const { pathname } = useLocation();
  if (!isStaff) return false;
  return shellLoadBanner(pathname, staffDataState({ sbReady, dataLoading, dataError, hasData: holdsStaffData({ data, clients, envois }) }).state);
}
