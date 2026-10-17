import {httpClient} from './httpClient';
export async function fetchStats(signal?: AbortSignal){const {data}=await httpClient.get('/stats/overview', { signal });return data;}
