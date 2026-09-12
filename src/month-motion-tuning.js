const nativeAnimate=Element.prototype.animate;

function isOldMonthTransition(keyframes,options){
  if(!Array.isArray(keyframes) || keyframes.length!==2) return false;
  if(Number(options?.duration)!==320) return false;

  const [first,last]=keyframes;

  return (
    typeof first?.transform==="string" &&
    typeof last?.transform==="string" &&
    "opacity" in first &&
    "opacity" in last &&
    (
      first.transform.includes("translate3d(28px") ||
      first.transform.includes("translate3d(-28px") ||
      first.transform.includes("translate3d(10px") ||
      first.transform.includes("translate3d(-10px") ||
      last.transform.includes("translate3d(28px") ||
      last.transform.includes("translate3d(-28px") ||
      last.transform.includes("translate3d(10px") ||
      last.transform.includes("translate3d(-10px")
    )
  );
}

function softenTransform(value){
  return value
    .replace("translate3d(28px","translate3d(14px")
    .replace("translate3d(-28px","translate3d(-14px")
    .replace("translate3d(10px","translate3d(6px")
    .replace("translate3d(-10px","translate3d(-6px");
}

function tunedKeyframes(keyframes){
  const [first,last]=keyframes;
  const outgoing=Number(first.opacity)===1;

  if(outgoing){
    return [
      {
        opacity:1,
        transform:softenTransform(first.transform),
        offset:0
      },
      {
        opacity:.92,
        transform:softenTransform(first.transform),
        offset:.22
      },
      {
        opacity:.12,
        transform:softenTransform(last.transform),
        offset:.52
      },
      {
        opacity:0,
        transform:softenTransform(last.transform),
        offset:.58
      },
      {
        opacity:0,
        transform:softenTransform(last.transform),
        offset:1
      }
    ];
  }

  return [
    {
      opacity:0,
      transform:softenTransform(first.transform),
      offset:0
    },
    {
      opacity:0,
      transform:softenTransform(first.transform),
      offset:.42
    },
    {
      opacity:.16,
      transform:softenTransform(first.transform),
      offset:.5
    },
    {
      opacity:.88,
      transform:"translate3d(0,0,0)",
      offset:.78
    },
    {
      opacity:1,
      transform:softenTransform(last.transform),
      offset:1
    }
  ];
}

Element.prototype.animate=function(keyframes,options){
  if(!isOldMonthTransition(keyframes,options)){
    return nativeAnimate.call(this,keyframes,options);
  }

  return nativeAnimate.call(
    this,
    tunedKeyframes(keyframes),
    {
      ...options,
      duration:230,
      easing:"cubic-bezier(.22,.72,.22,1)"
    }
  );
};
