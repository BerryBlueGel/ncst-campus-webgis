/** Clipboard permission/availability failures should not become unhandled UI errors. */
export async function copyAnalysisText(text:string,write:(text:string)=>Promise<void>):Promise<string>{
  try{await write(text);return '已复制结果';}
  catch{return '复制失败，请检查浏览器剪贴板权限后重试。';}
}
