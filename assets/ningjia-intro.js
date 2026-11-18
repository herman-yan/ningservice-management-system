/* 宁家服务品牌开场：按需播放，支持跳过、回看、暂停、原创配乐与全屏。 */
(function () {
  'use strict';

  var SESSION_KEY = 'ningjia.workorder.intro.seen.v1';
  var root, video, playButton, soundButton, progress, timeLabel, loading, errorBox, closeTimer, loadTimer;
  var previousFocus = null;
  var isOpen = false;

  var css = `
    .nj-intro[hidden]{display:none!important}
    .nj-intro{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#02070d;color:#eef7ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;opacity:0;transition:opacity .35s ease}
    .nj-intro.is-active{opacity:1}
    .nj-intro::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 45%,rgba(0,106,214,.16),transparent 58%);z-index:1}
    .nj-intro__video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#02070d}
    .nj-intro__top{position:absolute;z-index:3;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 28px;background:linear-gradient(180deg,rgba(2,7,13,.88),transparent)}
    .nj-intro__brand{display:flex;align-items:center;gap:12px;min-width:0}
    .nj-intro__mark{display:grid;place-items:center;width:36px;height:36px;flex:none;background:#006ad6;color:white;font-size:13px;font-weight:800;letter-spacing:-1px;clip-path:polygon(0 0,100% 0,100% 72%,72% 100%,0 100%)}
    .nj-intro__name{font-size:14px;font-weight:700;letter-spacing:1.5px;white-space:nowrap}
    .nj-intro__name small{display:block;margin-top:4px;color:#80c3ed;font-size:10px;font-weight:500;letter-spacing:2px}
    .nj-intro__skip,.nj-intro__retry{border:1px solid rgba(128,195,237,.5);border-radius:6px;background:rgba(5,19,33,.78);color:#f3f9ff;padding:11px 18px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;backdrop-filter:blur(12px);transition:background .2s,border-color .2s,transform .2s}
    .nj-intro__skip:hover,.nj-intro__retry:hover{background:#006ad6;border-color:#80c3ed;transform:translateY(-1px)}
    .nj-intro__skip:focus-visible,.nj-intro__retry:focus-visible,.nj-intro__control:focus-visible,.nj-intro__progress:focus-visible{outline:3px solid #80c3ed;outline-offset:3px}
    .nj-intro__bottom{position:absolute;z-index:3;left:0;right:0;bottom:0;padding:52px 28px 22px;background:linear-gradient(0deg,rgba(2,7,13,.94),transparent)}
    .nj-intro__bar{display:flex;align-items:center;gap:14px;max-width:1500px;margin:auto}
    .nj-intro__control{width:40px;height:40px;display:grid;place-items:center;flex:none;border:1px solid rgba(128,195,237,.4);border-radius:50%;background:rgba(8,28,47,.88);color:white;font-size:16px;cursor:pointer}
    .nj-intro__control:hover{background:#006ad6}
    .nj-intro__sound{font-size:10px;font-weight:700;letter-spacing:.2px}
    .nj-intro__sound.is-muted{opacity:.68;border-style:dashed}
    .nj-intro__progress{flex:1;min-width:60px;height:4px;accent-color:#006ad6;cursor:pointer}
    .nj-intro__time{min-width:98px;color:#d6e8f8;font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:.5px;text-align:center}
    .nj-intro__caption{display:flex;justify-content:space-between;gap:16px;max-width:1500px;margin:14px auto 0;color:#8ca9c2;font-size:11px;letter-spacing:1px}
    .nj-intro__loading,.nj-intro__error{position:absolute;z-index:2;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
    .nj-intro__loading[hidden],.nj-intro__error[hidden]{display:none}
    .nj-intro__spinner{width:42px;height:42px;margin:0 auto 14px;border:2px solid rgba(128,195,237,.22);border-top-color:#80c3ed;border-radius:50%;animation:nj-intro-spin .8s linear infinite}
    .nj-intro__loading span{color:#c6d9e9;font-size:13px;letter-spacing:2px}
    .nj-intro__error{max-width:min(420px,80vw);padding:24px;background:rgba(4,15,27,.94);border:1px solid rgba(128,195,237,.35);border-radius:12px;pointer-events:auto}
    .nj-intro__error p{margin:0 0 16px;color:#d8e9f7;font-size:14px;line-height:1.8}
    body.nj-intro-open{overflow:hidden}
    @keyframes nj-intro-spin{to{transform:rotate(360deg)}}
    @media(max-width:640px){.nj-intro__top{padding:16px}.nj-intro__name{font-size:12px;letter-spacing:.5px}.nj-intro__name small{font-size:9px;letter-spacing:1px}.nj-intro__mark{width:30px;height:30px}.nj-intro__skip{padding:10px 12px;font-size:12px}.nj-intro__bottom{padding:44px 16px 18px}.nj-intro__bar{gap:8px}.nj-intro__control{width:36px;height:36px}.nj-intro__time{min-width:78px;font-size:10px}.nj-intro__caption{font-size:9px;letter-spacing:0}.nj-intro__caption span:first-child{max-width:55%}}
    @media(prefers-reduced-motion:reduce){.nj-intro,.nj-intro__skip,.nj-intro__retry{transition:none}.nj-intro__spinner{animation:none;border-color:#80c3ed}}
  `;

  function formatTime(seconds) {
    var n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }

  function build() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = 'ningjiaIntro';
    root.className = 'nj-intro';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '宁家服务维修业务数字孪生开场动画');
    root.innerHTML = `
      <video class="nj-intro__video" preload="none" playsinline muted poster="../assets/ningjia-digital-twin-poster.jpg" aria-label="北京直营站维修业务数字孪生，64秒品牌动画，含原创电子科技配乐">
        <source src="../assets/ningjia-digital-twin.mp4" type="video/mp4">
      </video>
      <div class="nj-intro__top">
        <div class="nj-intro__brand"><span class="nj-intro__mark" aria-hidden="true">NJ</span><div class="nj-intro__name">NING SERVICE<small>您身边的新能源服务专家</small></div></div>
        <button class="nj-intro__skip" type="button" data-action="close">跳过开场，进入系统&nbsp; →</button>
      </div>
      <div class="nj-intro__loading" role="status"><div class="nj-intro__spinner"></div><span>品牌视界加载中</span></div>
      <div class="nj-intro__error" hidden role="alert"><p>视频暂时无法加载，您可以直接进入工单系统，或重新尝试播放。</p><button class="nj-intro__retry" type="button" data-action="retry">重新加载</button></div>
      <div class="nj-intro__bottom">
        <div class="nj-intro__bar">
          <button class="nj-intro__control" type="button" data-action="play" aria-label="暂停动画">Ⅱ</button>
          <input class="nj-intro__progress" type="range" min="0" max="64" step="0.1" value="0" aria-label="动画播放进度">
          <span class="nj-intro__time">00:00 / 01:04</span>
          <button class="nj-intro__control nj-intro__sound is-muted" type="button" data-action="sound" aria-label="开启原创科技配乐" aria-pressed="false" title="开启或关闭配乐">BGM</button>
          <button class="nj-intro__control" type="button" data-action="fullscreen" aria-label="全屏观看">⛶</button>
        </div>
        <div class="nj-intro__caption"><span>北京直营站 · 维修业务数字孪生</span><span>保内 / 保外双工单 · 全流程闭环</span></div>
      </div>`;
    document.body.appendChild(root);

    video = root.querySelector('video');
    playButton = root.querySelector('[data-action="play"]');
    soundButton = root.querySelector('[data-action="sound"]');
    progress = root.querySelector('.nj-intro__progress');
    timeLabel = root.querySelector('.nj-intro__time');
    loading = root.querySelector('.nj-intro__loading');
    errorBox = root.querySelector('.nj-intro__error');

    root.addEventListener('click', function (event) {
      var action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'close') close();
      if (action.dataset.action === 'play') togglePlay();
      if (action.dataset.action === 'sound') toggleSound();
      if (action.dataset.action === 'fullscreen') fullscreen();
      if (action.dataset.action === 'retry') startPlayback();
    });
    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', updateProgress);
    video.addEventListener('playing', function () {
      window.clearTimeout(loadTimer);
      loading.hidden = true;
      errorBox.hidden = true;
      playButton.textContent = 'Ⅱ';
      playButton.setAttribute('aria-label', '暂停动画');
    });
    video.addEventListener('waiting', function () { if (!video.paused) loading.hidden = false; });
    video.addEventListener('canplay', function () { loading.hidden = true; });
    video.addEventListener('pause', function () {
      playButton.textContent = '▶';
      playButton.setAttribute('aria-label', '继续播放');
    });
    video.addEventListener('ended', function () {
      playButton.textContent = '↻';
      playButton.setAttribute('aria-label', '重新播放');
      closeTimer = window.setTimeout(close, 900);
    });
    video.addEventListener('error', showLoadError);
    video.addEventListener('volumechange', updateSoundButton);
    progress.addEventListener('input', function () {
      if (Number.isFinite(video.duration)) video.currentTime = Number(progress.value);
      updateProgress();
    });
    document.addEventListener('keydown', onKeydown, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
    window.addEventListener('resize', syncViewport);
  }

  function updateProgress() {
    var current = video.currentTime || 0;
    var duration = Number.isFinite(video.duration) ? video.duration : 64;
    if (!progress.matches(':active')) progress.value = String(current);
    progress.max = String(duration);
    progress.setAttribute('aria-valuetext', formatTime(current) + '，共' + formatTime(duration));
    timeLabel.textContent = formatTime(current) + ' / ' + formatTime(duration);
  }

  function syncViewport() {
    if (!isOpen || !window.visualViewport) return;
    var viewport = window.visualViewport;
    root.style.width = Math.round(viewport.width) + 'px';
    root.style.height = Math.round(viewport.height) + 'px';
    root.style.left = Math.round(viewport.offsetLeft) + 'px';
    root.style.top = Math.round(viewport.offsetTop) + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function setBackgroundInert(value) {
    Array.prototype.forEach.call(document.body.children, function (element) {
      if (element === root || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return;
      if (value) {
        element.dataset.njIntroAria = element.getAttribute('aria-hidden') || '';
        element.setAttribute('aria-hidden', 'true');
        element.inert = true;
      } else {
        element.inert = false;
        if (element.dataset.njIntroAria) element.setAttribute('aria-hidden', element.dataset.njIntroAria);
        else element.removeAttribute('aria-hidden');
        delete element.dataset.njIntroAria;
      }
    });
  }

  function updateSoundButton() {
    if (!soundButton) return;
    soundButton.classList.toggle('is-muted', video.muted);
    soundButton.setAttribute('aria-label', video.muted ? '开启原创科技配乐' : '关闭原创科技配乐');
    soundButton.setAttribute('aria-pressed', video.muted ? 'false' : 'true');
    soundButton.title = video.muted ? '开启配乐' : '关闭配乐';
  }

  function toggleSound() {
    video.muted = !video.muted;
    video.volume = 0.9;
    updateSoundButton();
    if (!video.muted && video.paused) startPlayback();
  }

  function show(withSound) {
    if (isOpen) return;
    window.clearTimeout(closeTimer);
    isOpen = true;
    video.muted = !withSound;
    video.volume = 0.9;
    updateSoundButton();
    previousFocus = document.activeElement;
    syncViewport();
    root.hidden = true;
    root.classList.remove('is-active');
    root.hidden = false;
    document.body.classList.add('nj-intro-open');
    setBackgroundInert(true);
    video.currentTime = 0;
    errorBox.hidden = true;
    loading.hidden = false;
    updateProgress();
    root.querySelector('[data-action="close"]').focus({ preventScroll: true });
    window.requestAnimationFrame(function () { root.classList.add('is-active'); });
    startPlayback();
  }

  function startPlayback() {
    window.clearTimeout(loadTimer);
    errorBox.hidden = true;
    loading.hidden = false;
    video.preload = 'auto';
    loadTimer = window.setTimeout(function () {
      if (isOpen && video.readyState < 2) showLoadError();
    }, 10000);
    var promise = video.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(function () {
        loading.hidden = true;
        playButton.textContent = '▶';
        playButton.setAttribute('aria-label', '播放动画');
      });
    }
  }

  function showLoadError() {
    window.clearTimeout(loadTimer);
    loading.hidden = true;
    errorBox.hidden = false;
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', '播放动画');
  }

  function close() {
    if (!isOpen) return;
    window.clearTimeout(closeTimer);
    window.clearTimeout(loadTimer);
    video.pause();
    root.classList.remove('is-active');
    document.body.classList.remove('nj-intro-open');
    setBackgroundInert(false);
    isOpen = false;
    window.setTimeout(function () { if (!isOpen) root.hidden = true; }, 350);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }

  function togglePlay() {
    if (video.ended) video.currentTime = 0;
    if (video.paused) startPlayback();
    else video.pause();
  }

  function fullscreen() {
    var target = root;
    if (document.fullscreenElement) {
      var exit = document.exitFullscreen();
      if (exit && exit.catch) exit.catch(function () {});
    } else if (target.requestFullscreen) {
      var request = target.requestFullscreen();
      if (request && request.catch) request.catch(function () {});
    }
  }

  function onKeydown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.code === 'Space' && !event.target.closest('button,input')) {
      event.preventDefault();
      togglePlay();
    }
    if (event.key === 'Tab') {
      var items = Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]),input:not([disabled])')).filter(function (el) { return el.offsetParent !== null; });
      var first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  function init() {
    build();
    window.NingjiaIntro = { open: function () { show(true); }, close: close };
    /* 默认不自动播放：改为「按需播放」。
       原因：自动播放会在进入页面时用全屏视频盖住登录门，弱网下（视频体积较大）
       会长时间只看到黑屏，容易被误认为「页面打不开」。
       观看入口：侧栏「观看品牌开场」按钮，或在网址后加 ?intro=1 直接唤起。 */
    var force = new URLSearchParams(window.location.search).get('intro') === '1';
    if (force) { show(false); }
  }

  init();
})();
