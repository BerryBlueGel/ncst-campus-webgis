import { computed, ref, type Ref } from 'vue';
import { TEACHING_PART_IDS } from './TeachingPlanGeometry';

/** Inspecting a hidden source fragment is a temporary view, not a user preference
 * change. Returning to a main building (or clearing selection) restores the choice. */
export function createTeachingPreviewState(selectedId:Ref<string|null>) {
  const preferred=ref(true);
  const inspectingPart=computed(()=>selectedId.value!==null&&TEACHING_PART_IDS.includes(selectedId.value));
  const effective=computed({
    get:()=>preferred.value&&!inspectingPart.value,
    set:(enabled:boolean)=>{if(!inspectingPart.value)preferred.value=enabled;},
  });
  return {preferred,inspectingPart,effective};
}
