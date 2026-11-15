/** Display-only interpretation of the user's registered plan. Not deletion,
 * reclassification of authority data, or verified ownership of a neighboring roof. */
const rows=[
  ['010','9f9f4c341802b65221a6','PLANTED_OR_PAVED','B区2号楼北侧绿地'],
  ['026','25c1c81a85fc2e1c5974','PLANTED_OR_PAVED','B区庭院铺装'],
  ['028','2a5bd63e7fd8e3518b22','PLANTED_OR_PAVED','B区庭院铺装'],
  ['030','b4658425c3e11fdaddef','PLANTED_OR_PAVED','B区庭院景观'],
  ['031','528beac82113c104e39e','PLANTED_OR_PAVED','B区庭院台阶铺装'],
  ['032','a438afb470f8f4cf0d1f','PLANTED_OR_PAVED','B区8号楼北侧绿地'],
  ['034','cc3ce17fa62d88bfad88','PLANTED_OR_PAVED','图书馆前台阶'],
  ['037','cdabc3f17a4144230cfa','PLANTED_OR_PAVED','以升桥桥面及铺装'],
  ['088','ee41f8d6bdc58b5467de','PLANTED_OR_PAVED','梅园7号楼庭院铺装'],
  ['102','d70833c6b3da2e7043af','PLANTED_OR_PAVED','A区3号楼庭院景观'],
  ['107','f5a4ba32c58501257a30','PLANTED_OR_PAVED','南门东侧行政楼台阶'],
  ['124','c82b0c4a55bcfdab22a7','PLANTED_OR_PAVED','菊园南侧绿地'],
  ['127','0e28bd126b55d619bf5c','PLANTED_OR_PAVED','菊园内部绿地'],
  ['131','0fb437af3d315e0f030b','PLANTED_OR_PAVED','D区8号楼东侧绿地铺装'],
  ['134','d71de09b3a25b5f07b35','PLANTED_OR_PAVED','D区7号楼东侧绿地铺装'],
  ['140','cab3c831261b8e4a43a4','PLANTED_OR_PAVED','D区4号楼庭院景观'],
  ['142','d5a0a99b86d581ba236f','PLANTED_OR_PAVED','D区4号楼庭院铺装'],
  ['143','00f0531f295e2a81971b','PLANTED_OR_PAVED','D区4号楼庭院铺装'],
  ['166','b778c6eecb06aa75176f','PLANTED_OR_PAVED','北部绿地训练场'],
  ['024','8baf7e87df1d10dd961d','REFINED_LIBRARY_COMPONENT','展览中心：已纳入图书馆连续基座范围，不另挤出重叠楼体'],
  ['114','31433a84e9a0336455f4','REFINED_LIBRARY_COMPONENT','现教中心：已纳入图书馆连续基座范围，不另挤出重叠楼体'],
  ['086','388e7ae428b6068062cb','HISTORICAL_REPLACED_STAND','已由精修体育场替代的旧看台，不重建'],
  ['017','5406aa5430d00212d9e7','RETAIN_ROOF_FRAGMENT','兰园5号楼西侧独立白色小屋面，原轮廓保留'],
  ['047','cb64ee8051756c097c6b','RETAIN_ROOF_FRAGMENT','兰园1号楼小屋面，原轮廓保留'],
  ['051','b795fc43df83ff863ac7','RETAIN_ROOF_FRAGMENT','竹园2号楼小屋面，原轮廓保留'],
  ['083','73bcd79a72a4bcf7af29','RETAIN_ROOF_FRAGMENT','竹园3号楼西侧小屋面，原轮廓保留'],
  ['097','838f69cbcb84b6bed2b2','RETAIN_ROOF_FRAGMENT','梅园6号楼屋面端部，原轮廓保留'],
  ['007','0469554fc5581a49cec3','OWNER_OR_ROOF_SCOPE_UNCERTAIN','B区4号楼附近小块：归属与屋面范围未确认'],
  ['044','e12e4a81d80ca570f2fa','OWNER_OR_ROOF_SCOPE_UNCERTAIN','兰园3号楼角部：独立源块与主屋面边界未确认'],
  ['063','8c3f21b9a8bd43f5dbc2','OWNER_OR_ROOF_SCOPE_UNCERTAIN','兰园6号楼北楼西侧窄片：不自动并入062'],
  ['067','b910aecdb252a70a2f2b','OWNER_OR_ROOF_SCOPE_UNCERTAIN','竹园1号楼小块：不自动并入相邻主体'],
  ['076','98dbf7bc6177f74fdc1a','OWNER_OR_ROOF_SCOPE_UNCERTAIN','教师公寓东端源片：实际产权分界仍待核实，二维按总图展示'],
  ['077','87beaaa3c2777edaca7b','OWNER_OR_ROOF_SCOPE_UNCERTAIN','教师公寓北侧参考块：总图无独立白色屋面，仅隐藏二维楼体显示，实际归属及源记录保留'],
  ['137','9368c406b93d9280ed6b','OWNER_OR_ROOF_SCOPE_UNCERTAIN','D区4号楼北楼：连续白色屋面跨137/138，不能猜分界'],
  ['138','01f4781169cdebc320a0','OWNER_OR_ROOF_SCOPE_UNCERTAIN','D区4号楼北楼：不强制与137或139合并'],
  ['164','ada881d96d2ef1f43ca8','OWNER_OR_ROOF_SCOPE_UNCERTAIN','D区2号楼庭院端部：屋面/连接范围未确认'],
] as const;
export const CAMPUS_PLAN_DISPOSITIONS=rows.map(([label,key,status,note])=>({id:`buildings:${key}`,sourceLabel:`建筑 ${label}`,status,note,
  evidence:'USER_REGISTERED_PLAN_NOT_AS_BUILT',suppressed:status==='PLANTED_OR_PAVED'||status==='REFINED_LIBRARY_COMPONENT'}));
// These three predate this batch. Keep their source/review records unchanged,
// but include them in the whole-campus evidence-gap count and feature warnings.
export const EARLIER_OWNERSHIP_GAPS=[
  ['054','eea2b80f62a4d82b2c84'],['150','c00db434039442f40ee9'],['151','6a708aca8b5af56df102'],
].map(([label,key])=>({id:`buildings:${key}`,sourceLabel:`建筑 ${label}`,status:'OWNER_OR_ROOF_SCOPE_UNCERTAIN',
  note:'公共教学区独立源小块：屋面范围及相邻楼体归属未确认，保持原状，不自动合并',
  evidence:'EARLIER_REVIEW_OWNERSHIP_UNVERIFIED',suppressed:false}));
export const planDispositionFor=(id:string)=>CAMPUS_PLAN_DISPOSITIONS.find(r=>r.id===id)??EARLIER_OWNERSHIP_GAPS.find(r=>r.id===id);
/** Only 2D: not a change to the earlier 3D disposition registry or source data. */
export const PLAN_NON_ROOF_REFERENCE_IDS=['buildings:87beaaa3c2777edaca7b'] as const;
export const suppressedInPlanPreview=(id:string)=>planDispositionFor(id)?.suppressed===true||PLAN_NON_ROOF_REFERENCE_IDS.some(key=>key===id);
