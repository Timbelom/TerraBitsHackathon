// Minimal, framework-free page fade. It also respects reduced-motion preferences.
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduced){requestAnimationFrame(()=>document.documentElement.classList.add('page-visible'));}
else document.documentElement.classList.add('page-visible');
for(const link of document.querySelectorAll('a[href]')){
  link.addEventListener('click',e=>{
    if(reduced||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    if(link.target==='_blank'||link.hasAttribute('download')||link.hasAttribute('data-enter'))return;
    const target=new URL(link.href,location.href);
    if(target.origin!==location.origin||target.pathname===location.pathname&&target.hash)return;
    e.preventDefault();document.documentElement.classList.add('page-leaving');
    setTimeout(()=>{location.href=target.href},230);
  });
}
