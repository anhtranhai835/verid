/** Browser code shares the board's authenticated request helper; HTML never enters its DOM. */
export const MOCKUP_JS = String.raw`
let mockupView=false,mockupKey='';
function showMockups(show){mockupView=show;renderTask()}
$('details-tab').onclick=()=>showMockups(false);$('mockup-tab').onclick=()=>showMockups(true);
function renderMockups(task){
  const available=task.mockups.files.length>0;
  if(!available)mockupView=false;
  $('mockup-tab').hidden=!available;$('mockup-tab').setAttribute('aria-pressed',String(mockupView));
  $('details-tab').setAttribute('aria-pressed',String(!mockupView));
  $('task-details').hidden=mockupView;$('mockup-panel').hidden=!mockupView;
  if(!mockupView)return;
  const root=$('mockup-panel'),key=JSON.stringify([task.id,task.mockups.files]);
  if(mockupKey!==key){
    mockupKey=key;root.replaceChildren();
    for(const file of task.mockups.files){
      const choice=file.slice(0,-5),row=node('section','mockup-option');row.dataset.choice=choice;
      row.append(node('h3','',choice));
      const frame=node('iframe');frame.title=fmt('mockup_preview',{choice});
      frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
      row.append(frame);
      const label=node('label','',L.mockup_note),note=node('input');note.type='text';note.maxLength=1000;
      note.value=task.mockups.choice?.choice===choice?task.mockups.choice.note:'';label.append(note);
      const select=node('button','btn',L.mockup_choose);select.onclick=async()=>{
        const result=await act('mockup-choice',{module:task.id,choice,note:note.value});
        if(result)toast(L.mockup_saved);
      };
      const selected=node('p','help');selected.dataset.selected=choice;selected.setAttribute('role','status');
      row.append(label,select,selected);root.append(row);
      request('/api/action',{action:'mockup-token',module:task.id,file,revision:board.revision})
        .then(result=>{if(row.isConnected)frame.src=result.url})
        .catch(error=>{if(row.isConnected)row.append(node('p','help',error.message))});
    }
  }
  for(const row of root.children){row.querySelector('button').disabled=busy;row.querySelector('[data-selected]').textContent=task.mockups.choice?.choice===row.dataset.choice?L.mockup_selected:''}
}
`;
