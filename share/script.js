// =================== 全局变量 ===================
let userConfig = null;
let currentAudio = null;
let popupZIndexCursor = 10000;
const popupTimeouts = [];
let currentMessageIndex = 0;
let isPlaying = false;
let isWeChatBrowser = false; // 是否为微信浏览器
let weixinJSBridgeReady = false; // WeixinJSBridge 是否已就绪
let audioPlayEnabled = false; // 音频播放是否已启用（微信浏览器需要）
let isIOS = false; // 是否为 iOS 设备
let isSafari = false; // 是否为 Safari 浏览器

// 指纹识别相关变量
let fingerprintContainerElement = null;
let fingerprintSvgElement = null;
let fingerprintRippleElement = null;
let isFingerprintVerified = false;
let fingerprintHoldHandlers = null; // 保存长按事件处理器，便于移除

// =================== 初始化 ===================
document.addEventListener('DOMContentLoaded', async function() {
  // 检测是否为微信浏览器
  isWeChatBrowser = /MicroMessenger/i.test(navigator.userAgent);
  
  // 检测是否为 iOS 设备
  isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || 
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
  
  // 检测是否为 Safari 浏览器
  isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || 
             (isIOS && !isWeChatBrowser);
  
  // 检测是否为安卓设备
  const isAndroid = /Android/i.test(navigator.userAgent);
  
  console.log('🌐 浏览器环境检测:', {
    isWeChatBrowser,
    isIOS,
    isSafari,
    isAndroid,
    userAgent: navigator.userAgent,
    platform: navigator.platform
  });
  
  // 如果是微信浏览器，初始化 WeixinJSBridge
  if (isWeChatBrowser) {
    console.log('📱 检测到微信浏览器，初始化音频播放支持...');
    initWeixinJSBridge();
  }
  
  // iOS 特定优化
  if (isIOS) {
    console.log('🍎 设备检测到 iOS ，应用 iOS 优化...');
    
    // iOS Safari: 优化触摸响应
    document.body.style.webkitTouchCallout = 'default'; // 允许长按菜单（信件内容需要）
    document.body.style.touchAction = 'manipulation'; // 优化触摸操作
    
    // 信件内容区域允许文本选择
    const letterContentArea = document.getElementById('letterContentArea');
    if (letterContentArea) {
      letterContentArea.style.webkitUserSelect = 'text';
      letterContentArea.style.userSelect = 'text';
    }
    
    // iOS Safari: 优化滚动性能
    if (document.documentElement) {
      document.documentElement.style.webkitOverflowScrolling = 'touch'; // 启用 iOS 平滑滚动
    }
    
    // iOS Safari: 防止双击缩放（可选，根据需求）
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });
  }
  
  // 从URL获取configId
  const pathParts = window.location.pathname.split('/');
  const configId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
  
//   if (!configId || configId === 'share') {
//     showError('无效的分享链接');
//     return;
//   }
  
  // 加载配置
  await loadConfig(configId);
});

// =================== 初始化微信 JS Bridge ===================
function initWeixinJSBridge() {
  // 如果 WeixinJSBridge 已经存在，直接调用
  if (typeof WeixinJSBridge !== 'undefined') {
    enableAudioPlay();
    return;
  }
  
  // 监听 WeixinJSBridge 就绪事件
  if (document.addEventListener) {
    document.addEventListener('WeixinJSBridgeReady', enableAudioPlay, false);
  } else if (document.attachEvent) {
    document.attachEvent('WeixinJSBridgeReady', enableAudioPlay);
    document.attachEvent('onWeixinJSBridgeReady', enableAudioPlay);
  }
  
  // 备用方案：延迟检查
  setTimeout(() => {
    if (typeof WeixinJSBridge !== 'undefined' && !weixinJSBridgeReady) {
      enableAudioPlay();
    }
  }, 1000);
}

// =================== 启用音频播放（微信浏览器） ===================
function enableAudioPlay() {
  if (typeof WeixinJSBridge === 'undefined') {
    console.warn('WeixinJSBridge 未找到');
    return;
  }
  
  try {
    // 使用 WeixinJSBridge.on('ready') 方式（推荐方式）
    if (typeof WeixinJSBridge.on === 'function') {
      WeixinJSBridge.on('ready', () => {
        weixinJSBridgeReady = true;
        audioPlayEnabled = true;
        console.log('✅ 微信音频播放已启用 (on ready)');
        
        // 如果音频对象已创建但未播放，尝试播放
        if (currentAudio && currentAudio.paused) {
          tryPlayAudio(currentAudio);
        }
      });
    }
    
    // 备用方案：使用 invoke 方式
    if (!weixinJSBridgeReady) {
      WeixinJSBridge.invoke('getNetworkType', {}, () => {
        weixinJSBridgeReady = true;
        audioPlayEnabled = true;
        console.log('✅ 微信音频播放已启用 (invoke)');
        
        // 如果音频对象已创建但未播放，尝试播放
        if (currentAudio && currentAudio.paused) {
          tryPlayAudio(currentAudio);
        }
      });
    }
  } catch (error) {
    console.error('启用微信音频播放失败:', error);
  }
}

// =================== 创建音频对象（带微信浏览器和 iOS 优化） ===================
function createAudioElement(url) {
  console.log('🎵 创建音频对象:', url, 'iOS:', isIOS, 'Safari:', isSafari);
  const audio = new Audio();
  
  // 设置音频属性
  // iOS Safari 需要 playsinline 才能内联播放（不跳转到全屏播放器）
  audio.playsInline = true; // 内联播放（iOS 必需）
  audio.setAttribute('playsinline', 'true'); // 兼容性设置
  audio.setAttribute('webkit-playsinline', 'true'); // iOS 旧版本兼容
  
  // iOS Safari 优化：使用 metadata 预加载策略（更快）
  if (isIOS && isSafari) {
    audio.preload = 'metadata'; // iOS Safari 使用 metadata 预加载更快
  } else {
    audio.preload = 'auto'; // 其他浏览器使用 auto
  }
  
  // 安卓微信浏览器兼容
  audio.setAttribute('x5-playsinline', 'true');
  audio.setAttribute('x5-video-player-type', 'h5');
  
  // iOS 特定优化：禁用自动播放（iOS 不允许自动播放）
  audio.autoplay = false;
  
  // 添加错误监听
  audio.addEventListener('error', (e) => {
    console.error('❌ 音频加载错误:', e, audio.error, {
      code: audio.error?.code,
      message: audio.error?.message
    });
  });
  
  // 添加加载完成监听
  audio.addEventListener('canplaythrough', () => {
    console.log('✅ 音频加载完成，可以播放');
  });
  
  // iOS 特定：监听 loadedmetadata 事件（iOS 需要）
  if (isIOS) {
    audio.addEventListener('loadedmetadata', () => {
      console.log('📱 iOS: 音频元数据加载完成，时长:', audio.duration);
    });
    
    // iOS 特定：监听 loadeddata 事件
    audio.addEventListener('loadeddata', () => {
      console.log('📱 iOS: 音频数据加载完成');
    });
  }
  
  // 设置音频源
  audio.src = url;
  
  // 加载音频
  // iOS Safari: 不需要立即 load()，会在用户交互时自动加载
  // 其他浏览器：需要 load() 来预加载
  if (!isIOS || !isSafari) {
    audio.load();
  }
  
  console.log('🎵 音频对象创建完成，readyState:', audio.readyState);
  
  return audio;
}

// =================== 尝试播放音频（带微信浏览器支持） ===================
function tryPlayAudio(audio, isUserInteraction = false) {
  if (!audio) return Promise.resolve();
  
  // 如果是用户交互触发的播放，直接尝试播放
  if (isUserInteraction) {
    console.log('👆 用户交互触发播放，readyState:', audio.readyState, 'iOS:', isIOS);
    
    // iOS Safari 特殊处理
    if (isIOS && isSafari) {
      // iOS Safari: 需要先加载音频（如果还没加载）
      if (audio.readyState === 0) {
        console.log('📱 iOS: 音频未加载，开始加载...');
        audio.load();
      }
      
      // iOS Safari: 等待音频可以播放（至少需要 loadeddata）
      if (audio.readyState < 2) {
        console.log('📱 iOS: 等待音频加载，readyState:', audio.readyState);
        return new Promise((resolve, reject) => {
          // iOS 使用 loadeddata 事件（比 canplaythrough 更快）
          const onLoadedData = () => {
            audio.removeEventListener('loadeddata', onLoadedData);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            console.log('✅ iOS: 音频数据加载完成，开始播放');
            audio.play().then(resolve).catch(reject);
          };
          
          const onCanPlay = () => {
            audio.removeEventListener('loadeddata', onLoadedData);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            console.log('✅ iOS: 音频可以播放，开始播放');
            audio.play().then(resolve).catch(reject);
          };
          
          const onError = (e) => {
            audio.removeEventListener('loadeddata', onLoadedData);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            console.error('❌ iOS: 音频加载失败:', e);
            reject(e);
          };
          
          // 如果已经可以播放，直接播放
          if (audio.readyState >= 2) {
            audio.play().then(resolve).catch(reject);
            return;
          }
          
          audio.addEventListener('loadeddata', onLoadedData);
          audio.addEventListener('canplay', onCanPlay);
          audio.addEventListener('error', onError);
          
          // 超时处理（iOS 使用更短的超时时间）
          setTimeout(() => {
            audio.removeEventListener('loadeddata', onLoadedData);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            if (audio.readyState >= 2) {
              audio.play().then(resolve).catch(reject);
            } else {
              reject(new Error('iOS 音频加载超时'));
            }
          }, 3000);
        });
      }
    } else {
      // 非 iOS Safari 的处理（安卓微信浏览器等）
      if (audio.readyState < 2) {
        console.log('⏳ 音频未就绪，重新加载...');
        audio.load();
        // 等待音频加载
        return new Promise((resolve, reject) => {
          const onCanPlay = () => {
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('error', onError);
            console.log('✅ 音频加载完成，开始播放');
            audio.play().then(resolve).catch(reject);
          };
          const onError = (e) => {
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('error', onError);
            console.error('❌ 音频加载失败:', e);
            reject(e);
          };
          audio.addEventListener('canplaythrough', onCanPlay);
          audio.addEventListener('error', onError);
          // 超时处理
          setTimeout(() => {
            audio.removeEventListener('canplaythrough', onCanPlay);
            audio.removeEventListener('error', onError);
            if (audio.readyState >= 2) {
              audio.play().then(resolve).catch(reject);
            } else {
              reject(new Error('音频加载超时'));
            }
          }, 5000);
        });
      }
    }
    
    // 直接播放
    try {
      console.log('▶️ 尝试播放音频...');
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        return playPromise.then(() => {
          console.log('✅ 音频播放成功');
        }).catch(error => {
          console.error('❌ 用户交互后播放失败:', error, 'readyState:', audio.readyState);
          throw error;
        });
      }
    } catch (error) {
      console.error('❌ 播放异常:', error);
      return Promise.reject(error);
    }
  }
  
  // 微信浏览器需要先启用音频播放
  if (isWeChatBrowser && !audioPlayEnabled) {
    // 如果 WeixinJSBridge 已就绪但未启用，尝试启用
    if (typeof WeixinJSBridge !== 'undefined' && !weixinJSBridgeReady) {
      enableAudioPlay();
    }
    
    // 等待用户交互后再播放（微信浏览器限制）
    return Promise.reject(new Error('需要用户交互才能播放音频'));
  }
  
  // 确保音频已加载
  if (audio.readyState < 2) {
    audio.load();
  }
  
  // 尝试播放
  return audio.play().catch(error => {
    console.warn('音频播放失败，将在用户交互后重试:', error);
    // 如果播放失败，在用户交互后重试
    const retryPlay = (e) => {
      // 阻止事件冒泡，确保只触发一次
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      tryPlayAudio(audio, true).catch(err => {
        console.error('重试播放失败:', err);
      });
      // 移除事件监听器（只重试一次）
      document.removeEventListener('touchstart', retryPlay);
      document.removeEventListener('click', retryPlay);
      document.removeEventListener('touchend', retryPlay);
    };
    
    // 监听用户交互（安卓优先使用 touchstart）
    document.addEventListener('touchstart', retryPlay, { once: true, passive: false });
    document.addEventListener('touchend', retryPlay, { once: true, passive: false });
    document.addEventListener('click', retryPlay, { once: true, passive: false });
    
    throw error;
  });
}

// =================== 加载配置 ===================
async function loadConfig() {
    let result = {
        "success": true,
        "data": {
            "id": 6,
            "config_id": "190639",
            "friend_name": "程走柳",
            "shape": "square",
            "envelope_color": null,
            "envelope_stickers": null,
            "stamp": null,
            "color": "random",
            "square_custom_color": null,
            "background": "default",
            "custom_background_image": null,
            "letter_paper": null,
            "music_id": 44,
            "music_api_provider": null,
            "music_api_songid": null,
            "play_mode": "partial", // 播放模式：partial（部分播放） / full（全播放）
            "partial_end_time": "104.55", 
            "partial_start_time": "0", // 部分播放开始时间（秒）
            "message_type": "custom",
            "custom_messages": [
                "鸡蛋在冰箱的第二层",
                "牛奶在冰箱的第三层",
                "荔枝在冰箱的第四层",
                "走柳 出门记得看天气预报",
                "下雨了要记得带伞",
                "不要再进鳄鱼池了",
                "不要让自己深陷险境",
                "以后不会有人挡在你面前了",
                "不要再睡在浴缸里了，会着凉的",
                "走柳 天地之宽 出路万万千",
                "如果你没有出路，那便由我为你开辟一条出路",
                "你总是一遍一遍试探着我的真心",
                "只要我们同频，就会有回应",
                "你是程走柳 我爱的是全部的程走柳",
                "我的爱 从来都是拿得出手的",
                "你要玩儿我 就玩儿我一辈子",
                "你的虚情假意和你的真心，哪一个会先杀死我",
                "我自愿被你利用",
                "我愿意在你的谎言中沉沦，我赌到了你的真心",
                "我终于可以出现在你的频道里了",
                "如果撑伞不够诚意，那我淋雨陪你 我的爱人",
                "程走柳 你厉害 你玩我像玩狗一样。",
                '遇见你是我今生最大的幸运',
                '你不能总是挥开手，不给我任何一个原因',
                '如果你要接近我，就不要突然不接近了',
                '我身无长物，烂人真心，唯有贱命一条，价值千金。',
                '赠予程走柳小姐，做生辰贺礼',
                '我爱你,我真的想陪你一直走下去，真的',
                '如你所说，原来天地之宽，出路万万千，可我的路全部以你为终点',
                '珠水不必美，天地之宽，容得下你的不喜欢',
                '再陪我走走吧，去完成我们的老派约会',
                '蒋伯驾的爱，只属于程走柳',
                '你是我暗室逢灯的际遇、绝渡逢舟的功德',
                '“程走柳，我爱你！！！”'
            ],
            "window_speed": 500,
            "square_opacity": "0.30",
            "created_at": "2025-12-04T20:20:00.000Z"
        }
    }

    // ===== config from backend: /api/site (fallback = built-in default above) =====
    try {
      const resp = await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' });
      if (resp.ok) {
        const remote = await resp.json();
        if (remote && remote.success && remote.data) {
          result = remote;
        }
      }
    } catch (e) {
      console.warn('remote config unavailable, using built-in default', e);
    }

    if (result.success && result.data) {
      userConfig = result.data;
      console.log('✅ 配置加载成功:', userConfig);
      showWelcome();
    } else {
      showError(result.message || '配置不存在');
    }
}

// =================== 显示欢迎页面 ===================
function showWelcome() {
  const loadingContainer = document.getElementById('loadingContainer');
  const welcomeContainer = document.getElementById('welcomeContainer');
  const welcomeTitle = document.getElementById('welcomeTitle');
  const welcomeMessage = document.getElementById('welcomeMessage');
  const startBtn = document.getElementById('startBtn');
  
  loadingContainer.style.display = 'none';
  welcomeContainer.style.display = 'flex';
  
  const friendName = userConfig.friend_name || '朋友';
  welcomeTitle.textContent = `Hi，${friendName}！`;
  welcomeMessage.textContent = userConfig.welcome_message || '没想到吧，其实我一直都在你身边';
  if (userConfig.page_title) { document.title = userConfig.page_title; }
  const scanMsgEl = document.getElementById('scanMessage');
  if (scanMsgEl && userConfig.scan_message) { scanMsgEl.textContent = userConfig.scan_message; }
  
  // 绑定开始按钮（iOS 和安卓微信浏览器优化）
  const handleStart = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // 在用户点击后，如果是微信浏览器，尝试启用音频播放
    if (isWeChatBrowser && !audioPlayEnabled && typeof WeixinJSBridge !== 'undefined') {
      enableAudioPlay();
    }
    
    // iOS Safari: 用户交互后，如果音频未加载，先加载
    if (isIOS && isSafari && currentAudio && currentAudio.readyState === 0) {
      console.log('📱 iOS: 用户交互后加载音频');
      currentAudio.load();
    }
    
    // 如果音频已创建，尝试播放（用户交互触发）
    if (currentAudio && currentAudio.paused) {
      tryPlayAudio(currentAudio, true).catch(() => {});
    }
    
    startShow();
  };
  
  // iOS 优先使用 touchstart（更快的响应）
  if (isIOS) {
    startBtn.addEventListener('touchstart', handleStart, { passive: false });
    // iOS 也需要 click 事件（某些情况下 touchstart 可能不触发）
    startBtn.addEventListener('click', handleStart, { passive: false });
  } else {
    startBtn.addEventListener('touchstart', handleStart, { passive: false });
    startBtn.addEventListener('click', handleStart, { passive: false });
  }
}

// =================== 显示错误 ===================
function showError(message) {
  const loadingContainer = document.getElementById('loadingContainer');
  const errorContainer = document.getElementById('errorContainer');
  const errorMessage = document.getElementById('errorMessage');
  
  loadingContainer.style.display = 'none';
  errorContainer.style.display = 'flex';
  errorMessage.textContent = message;
}

// =================== 开始展示 ===================
function startShow() {
  const welcomeContainer = document.getElementById('welcomeContainer');
  welcomeContainer.style.opacity = '0';
  
  setTimeout(() => {
    welcomeContainer.style.display = 'none';
    
    // 检测是否是方框模式
    const shape = userConfig.shape || 'square';
    if (shape === 'square') {
      // 方框模式：显示扫描界面
      showScanInterface();
    } else {
      // 信封模式：显示"你有一封信"提示
      showEnvelopeNotice();
    }
  }, 300);
}

// =================== 显示扫描界面（指纹识别） ===================
function showScanInterface() {
  const scanContainer = document.getElementById('scanContainer');
  scanContainer.style.display = 'flex';
  
  // 获取元素
  fingerprintContainerElement = document.getElementById('fingerprintContainer');
  fingerprintSvgElement = document.getElementById('fingerprintSvg');
  fingerprintRippleElement = document.getElementById('fingerprintRipple');
  
  // 初始化指纹识别功能
  initFingerprintHold();
}

// =================== 初始化指纹长按功能 ===================
function initFingerprintHold() {
  if (!fingerprintContainerElement) return;
  
  const progressRing = document.getElementById('progressRingCircle');
  const HOLD_DURATION = 1500; // 长按时间 1.5秒
  let pressTimer = null;
  let isPressed = false;
  
  // 圆环周长 = 2 * PI * r (r=54)
  const circumference = 2 * Math.PI * 54;
  
  if (progressRing) {
    progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
    progressRing.style.strokeDashoffset = circumference;
  }
  
  const startPress = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (isFingerprintVerified || isPressed) return;
    isPressed = true;
    
    // 添加按压效果
    fingerprintContainerElement.classList.add('active');
    fingerprintSvgElement.style.transform = 'scale(0.95)';
    
    // 开始进度条动画
    if (progressRing) {
      // 强制重绘以确保过渡效果生效
      progressRing.style.transition = 'none';
      progressRing.style.strokeDashoffset = circumference;
      progressRing.getBoundingClientRect(); // 触发重绘
      
      progressRing.style.transition = `stroke-dashoffset ${HOLD_DURATION}ms linear`;
      progressRing.style.strokeDashoffset = '0';
    }
    
    // 启动成功定时器
    pressTimer = setTimeout(() => {
      handleSuccess();
    }, HOLD_DURATION);
  };
  
  const endPress = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!isPressed || isFingerprintVerified) return;
    isPressed = false;
    
    // 清除定时器
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    
    // 复位样式
    fingerprintContainerElement.classList.remove('active');
    fingerprintSvgElement.style.transform = '';
    
    // 复位进度条
    if (progressRing) {
      progressRing.style.transition = 'stroke-dashoffset 0.3s ease-out';
      progressRing.style.strokeDashoffset = circumference;
    }
  };
  
  const handleSuccess = () => {
    isPressed = false;
    isFingerprintVerified = true;
    
    // 确保进度条满了
    if (progressRing) {
      progressRing.style.transition = 'none';
      progressRing.style.strokeDashoffset = '0';
    }
    
    // 添加波纹效果
    addRippleEffect();
    
    // 添加成功样式
    fingerprintContainerElement.classList.add('success');
    
    // 处理验证成功
    setTimeout(() => {
      handleFingerprintSuccess();
    }, 500);
  };

  // 暴露给外部以便成功后移除监听
  fingerprintHoldHandlers = {
    startPress,
    endPress,
    clearTimer: () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }
  };
  
  // 添加事件监听器 (支持触摸和鼠标)
  fingerprintContainerElement.addEventListener('touchstart', startPress, { passive: false });
  fingerprintContainerElement.addEventListener('touchend', endPress, { passive: false });
  fingerprintContainerElement.addEventListener('touchcancel', endPress, { passive: false });
  
  fingerprintContainerElement.addEventListener('mousedown', startPress);
  fingerprintContainerElement.addEventListener('mouseup', endPress);
  fingerprintContainerElement.addEventListener('mouseleave', endPress);
  
  // 防止拖拽时选中文本
  fingerprintContainerElement.style.userSelect = 'none';
  fingerprintContainerElement.style.webkitUserSelect = 'none';
  fingerprintContainerElement.style.touchAction = 'none'; // 禁用浏览器默认触摸行为
}

// =================== 添加波纹效果 ===================
function addRippleEffect() {
  if (!fingerprintRippleElement) return;
  
  // 重置波纹
  fingerprintRippleElement.classList.remove('active');
  
  // 触发波纹动画
  requestAnimationFrame(() => {
    fingerprintRippleElement.classList.add('active');
  });
  
  // 清除波纹效果
  setTimeout(() => {
    fingerprintRippleElement.classList.remove('active');
  }, 600);
}

// =================== 处理指纹验证成功 ===================
function handleFingerprintSuccess() {
  // 移除长按事件监听器并清理状态
  if (fingerprintContainerElement && fingerprintHoldHandlers) {
    fingerprintContainerElement.removeEventListener('touchstart', fingerprintHoldHandlers.startPress);
    fingerprintContainerElement.removeEventListener('touchend', fingerprintHoldHandlers.endPress);
    fingerprintContainerElement.removeEventListener('touchcancel', fingerprintHoldHandlers.endPress);
    fingerprintContainerElement.removeEventListener('mousedown', fingerprintHoldHandlers.startPress);
    fingerprintContainerElement.removeEventListener('mouseup', fingerprintHoldHandlers.endPress);
    fingerprintContainerElement.removeEventListener('mouseleave', fingerprintHoldHandlers.endPress);
    fingerprintHoldHandlers.clearTimer();
    fingerprintHoldHandlers = null;
  }
  // 禁用后续交互
  if (fingerprintContainerElement) {
    fingerprintContainerElement.style.pointerEvents = 'none';
  }
  
    // 在用户交互后，如果是微信浏览器，尝试启用音频播放
    if (isWeChatBrowser && !audioPlayEnabled && typeof WeixinJSBridge !== 'undefined') {
      enableAudioPlay();
    }
    
    // iOS Safari: 用户交互后，如果音频未加载，先加载
    if (isIOS && isSafari && currentAudio && currentAudio.readyState === 0) {
      console.log('📱 iOS: 用户交互后加载音频');
      currentAudio.load();
    }
    
    // 如果音频已创建，尝试播放（用户交互触发 - 指纹验证操作）
    if (currentAudio && currentAudio.paused) {
      tryPlayAudio(currentAudio, true).catch(() => {});
    }
  
  // 添加成功动画延迟
  setTimeout(() => {
    const scanContainer = document.getElementById('scanContainer');
    scanContainer.style.opacity = '0';
    
    setTimeout(() => {
      scanContainer.style.display = 'none';
      continueAfterScan();
    }, 300);
  }, 500); // 延迟500ms让用户看到成功效果
}

// =================== 信封模式：显示"你有一封信"提示 ===================
function showEnvelopeNotice() {
  const envelopeNoticeContainer = document.getElementById('envelopeNoticeContainer');
  const envelopeNoticeMessage = document.getElementById('envelopeNoticeMessage');
  const envelopeNoticeBtn = document.getElementById('envelopeNoticeBtn');
  
  const friendName = userConfig.friend_name || '朋友';
  envelopeNoticeMessage.textContent = `${friendName}为你准备了一封温柔的信`;
  
  envelopeNoticeContainer.style.display = 'flex';
  
  // 绑定查看按钮（iOS 和安卓微信浏览器优化）
  const handleEnvelopeNotice = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // 在用户点击后，如果是微信浏览器，尝试启用音频播放
    if (isWeChatBrowser && !audioPlayEnabled && typeof WeixinJSBridge !== 'undefined') {
      enableAudioPlay();
    }
    
    // iOS Safari: 用户交互后，如果音频未加载，先加载
    if (isIOS && isSafari && currentAudio && currentAudio.readyState === 0) {
      console.log('📱 iOS: 用户交互后加载音频');
      currentAudio.load();
    }
    
    // 如果音频已创建，尝试播放（用户交互触发）
    if (currentAudio && currentAudio.paused) {
      tryPlayAudio(currentAudio, true).catch(() => {});
    }
    
    envelopeNoticeContainer.style.opacity = '0';
    setTimeout(() => {
      envelopeNoticeContainer.style.display = 'none';
      showEnvelopeFront();
    }, 300);
  };
  
  // iOS 优先使用 touchstart
  if (isIOS) {
    envelopeNoticeBtn.addEventListener('touchstart', handleEnvelopeNotice, { passive: false });
    envelopeNoticeBtn.addEventListener('click', handleEnvelopeNotice, { passive: false });
  } else {
    envelopeNoticeBtn.addEventListener('touchstart', handleEnvelopeNotice, { passive: false });
    envelopeNoticeBtn.addEventListener('click', handleEnvelopeNotice, { passive: false });
  }
}

// =================== 信封状态变量 ===================
let isEnvelopeFlipped = false;
let isEnvelopeOpen = false;

// =================== 信封模式：显示信封正面 ===================
function showEnvelopeFront() {
  const envelopeFrontContainer = document.getElementById('envelopeFrontContainer');
  const envelopeFront = document.getElementById('envelopeFront');
  const envelopeFrontTitle = document.getElementById('envelopeFrontTitle');
  const envelope3dInner = document.getElementById('envelope3dInner');
  const envelopeTop = document.getElementById('envelopeTop');
  const flipHint = document.getElementById('envelopeFlipHint');
  
  // 重置信封状态
  isEnvelopeFlipped = false;
  isEnvelopeOpen = false;
  if (envelope3dInner) {
    envelope3dInner.classList.remove('is-flipped');
  }
  if (envelopeTop) {
    envelopeTop.classList.remove('is-open');
  }
  
  // 重置翻转提示状态
  if (flipHint) {
    flipHint.style.opacity = '0';
    flipHint.style.pointerEvents = 'auto';
  }
  
  // 设置信封颜色
  const envelopeColor = getEnvelopeColor();
  if (envelopeFront) {
    envelopeFront.style.background = envelopeColor.base;
    envelopeFront.style.borderColor = envelopeColor.border;
  }
  
  // 设置标题
  const friendName = userConfig.friend_name || '朋友';
  if (envelopeFrontTitle) {
    envelopeFrontTitle.textContent = `Dear ${friendName}`;
    envelopeFrontTitle.style.color = envelopeColor.textColor;
  }
  
  // 应用信封颜色到所有相关元素
  applyEnvelopeColorToShare(envelopeColor);
  
  // 加载邮票
  if (userConfig.stamp) {
    loadEnvelopeStamp(userConfig.stamp);
  }
  
  // 加载贴纸
  if (userConfig.envelope_stickers) {
    try {
      const stickers = typeof userConfig.envelope_stickers === 'string' 
        ? JSON.parse(userConfig.envelope_stickers) 
        : userConfig.envelope_stickers;
      if (Array.isArray(stickers)) {
        loadEnvelopeStickers(stickers);
      }
    } catch (e) {
      console.error('解析贴纸数据失败:', e);
    }
  }
  
  envelopeFrontContainer.style.display = 'flex';
  
  // 强制浏览器重新渲染，确保清晰度
  requestAnimationFrame(() => {
    if (envelope3dInner) {
      envelope3dInner.style.transform = 'translateZ(0)';
      // 触发重排
      void envelope3dInner.offsetHeight;
      envelope3dInner.style.transform = '';
    }
  });
  
  // 初始化滑动翻转功能
  initEnvelopeSwipe();
  
  // 添加翻转提示动画
  if (flipHint) {
    setTimeout(() => {
      flipHint.style.opacity = '1';
      flipHint.style.transform = 'translateY(0)';
    }, 500);
  }
}

// =================== 应用信封颜色 ===================
function applyEnvelopeColorToShare(envelopeColor) {
  const envelopeFront = document.getElementById('envelopeFront');
  const envelopeTopFront = document.querySelector('.envelope-top-front');
  const envelopeBottom = document.getElementById('envelopeBottom');
  const envelopeTitle = document.getElementById('envelopeFrontTitle');
  
  if (envelopeFront) {
    envelopeFront.style.background = envelopeColor.base;
    envelopeFront.style.borderColor = envelopeColor.border;
  }
  
  if (envelopeTopFront) {
    envelopeTopFront.style.background = envelopeColor.base;
    envelopeTopFront.style.borderColor = envelopeColor.border;
  }
  
  if (envelopeBottom) {
    envelopeBottom.style.background = envelopeColor.base;
    envelopeBottom.style.borderColor = envelopeColor.border;
  }
  
  if (envelopeTitle) {
    envelopeTitle.style.color = envelopeColor.textColor;
  }
}

// =================== 翻转信封 ===================
function flipEnvelope() {
  const envelope3dInner = document.getElementById('envelope3dInner');
  const envelopeTop = document.getElementById('envelopeTop');
  const flipHint = document.getElementById('envelopeFlipHint');
  
  isEnvelopeFlipped = !isEnvelopeFlipped;
  
  if (envelope3dInner) {
    if (isEnvelopeFlipped) {
      envelope3dInner.classList.add('is-flipped');
    } else {
      envelope3dInner.classList.remove('is-flipped');
    }
  }
  
  // 更新翻转提示的显示状态
  if (flipHint) {
    if (isEnvelopeFlipped) {
      flipHint.style.opacity = '0';
      flipHint.style.pointerEvents = 'none';
    } else {
      flipHint.style.opacity = '1';
      flipHint.style.pointerEvents = 'auto';
    }
  }
  
  // 翻转时重置信封盖子状态为关闭
  if (envelopeTop) {
    envelopeTop.classList.remove('is-open');
    isEnvelopeOpen = false;
  }
}

// =================== 打开/关闭信封盖 ===================
function toggleEnvelopeOpen() {
  const envelopeTop = document.getElementById('envelopeTop');
  if (!envelopeTop) return;
  
  // 基于DOM的实际状态来切换
  const isCurrentlyOpen = envelopeTop.classList.contains('is-open');
  
  if (isCurrentlyOpen) {
    envelopeTop.classList.remove('is-open');
    isEnvelopeOpen = false;
  } else {
    envelopeTop.classList.add('is-open');
    isEnvelopeOpen = true;
    
    // 在用户交互后，如果是微信浏览器，尝试启用音频播放
    if (isWeChatBrowser && !audioPlayEnabled && typeof WeixinJSBridge !== 'undefined') {
      enableAudioPlay();
    }
    
    // iOS Safari: 用户交互后，如果音频未加载，先加载
    if (isIOS && isSafari && currentAudio && currentAudio.readyState === 0) {
      console.log('📱 iOS: 用户交互后加载音频');
      currentAudio.load();
    }
    
    // 如果音频已创建，尝试播放（用户交互触发 - 打开信封操作）
    if (currentAudio && currentAudio.paused) {
      tryPlayAudio(currentAudio, true).catch(() => {});
    }
    
    // 打开后自动显示信件内容
    setTimeout(() => {
      openEnvelope();
    }, 800);
  }
}

// =================== 初始化滑动翻转功能 ===================
function initEnvelopeSwipe() {
  const envelope3dWrapper = document.querySelector('.envelope-3d-wrapper');
  if (!envelope3dWrapper) return;
  
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;
  const SWIPE_THRESHOLD = 50; // 滑动阈值
  
  // 触摸开始（iOS 优化）
  envelope3dWrapper.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isSwiping = true;
    }
  }, { 
    passive: true,
    // iOS 优化：使用 capture 阶段可以更快响应
    capture: isIOS
  });
  
  // 触摸移动
  envelope3dWrapper.addEventListener('touchmove', (e) => {
    if (!isSwiping || e.touches.length !== 1) return;
    
    const touchCurrentX = e.touches[0].clientX;
    const touchCurrentY = e.touches[0].clientY;
    const deltaX = touchCurrentX - touchStartX;
    const deltaY = touchCurrentY - touchStartY;
    
    // 判断是否为水平滑动（水平距离大于垂直距离）
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      e.preventDefault();
    }
  }, { passive: false });
  
  // 触摸结束（iOS 优化）
  envelope3dWrapper.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    // 判断是否为有效的水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        // 向右滑动 - 翻转到背面
        if (!isEnvelopeFlipped) {
          flipEnvelope();
        }
      } else {
        // 向左滑动 - 翻转到正面
        if (isEnvelopeFlipped) {
          flipEnvelope();
        }
      }
    }
    
    isSwiping = false;
  }, { 
    passive: true,
    // iOS 优化：使用 capture 阶段可以更快响应
    capture: isIOS
  });
  
  // 鼠标拖拽支持（桌面端）
  let mouseStartX = 0;
  let isDragging = false;
  
  envelope3dWrapper.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // 左键
      mouseStartX = e.clientX;
      isDragging = true;
      envelope3dWrapper.style.cursor = 'grabbing';
    }
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    // 可以在这里添加拖拽时的视觉反馈
  });
  
  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    
    const mouseEndX = e.clientX;
    const deltaX = mouseEndX - mouseStartX;
    
    if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
      if (deltaX > 0) {
        // 向右拖拽 - 翻转到背面
        if (!isEnvelopeFlipped) {
          flipEnvelope();
        }
      } else {
        // 向左拖拽 - 翻转到正面
        if (isEnvelopeFlipped) {
          flipEnvelope();
        }
      }
    }
    
    isDragging = false;
    envelope3dWrapper.style.cursor = '';
  });
}

// =================== 加载信封邮票 ===================
async function loadEnvelopeStamp(stampId) {
  try {
    const response = await fetch('/api/stamps');
    const result = await response.json();
    
    if (result.success && result.data) {
      const stamp = result.data.find(s => s.id === stampId);
      if (stamp) {
        const stampElement = document.getElementById('envelopeStamp');
        if (stampElement) {
          if (stamp.imageUrl) {
            stampElement.innerHTML = `<img src="${stamp.imageUrl}" alt="${stamp.name}" class="envelope-stamp-image" />`;
            stampElement.classList.add('has-image');
          } else {
            stampElement.innerHTML = `
              ${stamp.icon ? `<div class="stamp-icon">${stamp.icon}</div>` : ''}
              <div class="stamp-label">${stamp.label || stamp.name}</div>
            `;
          }
          stampElement.classList.add('show');
        }
      }
    }
  } catch (error) {
    console.error('加载邮票失败:', error);
  }
}

// =================== 加载信封贴纸 ===================
async function loadEnvelopeStickers(stickers) {
  try {
    const response = await fetch('/api/stickers');
    const result = await response.json();
    
    if (result.success && result.data) {
      stickers.forEach(stickerData => {
        // 贴纸数据格式：{ id, side, left, top } 或 { stickerId, x, y, size, rotation }
        const stickerId = stickerData.id || stickerData.stickerId;
        if (stickerId) {
          const side = stickerData.side || 'front';
          const containerId = side === 'front' 
            ? 'envelopeStickerContainerFront' 
            : 'envelopeStickerContainerBack';
          const stickerContainer = document.getElementById(containerId);
          
          if (!stickerContainer) return;
          
          const sticker = result.data.find(s => s.id === Number(stickerId) || s.id === stickerId);
          if (sticker) {
            const stickerEl = document.createElement('img');
            stickerEl.src = sticker.url;
            stickerEl.alt = sticker.name;
            stickerEl.className = 'envelope-front-sticker';
            stickerEl.style.position = 'absolute';
            // 支持两种位置格式：left/top (带px) 或 x/y (百分比)
            if (stickerData.left) {
              stickerEl.style.left = stickerData.left;
            } else {
              stickerEl.style.left = (stickerData.x || 0) + '%';
            }
            if (stickerData.top) {
              stickerEl.style.top = stickerData.top;
            } else {
              stickerEl.style.top = (stickerData.y || 0) + '%';
            }
            stickerEl.style.width = (stickerData.size || 60) + 'px';
            stickerEl.style.transform = `rotate(${stickerData.rotation || 0}deg)`;
            stickerEl.style.pointerEvents = 'none';
            stickerContainer.appendChild(stickerEl);
          }
        }
      });
    }
  } catch (error) {
    console.error('加载贴纸失败:', error);
  }
}

// =================== 打开信封 ===================
function openEnvelope() {
  const envelopeFrontContainer = document.getElementById('envelopeFrontContainer');
  const envelopeContentContainer = document.getElementById('envelopeContentContainer');
  
  if (!envelopeFrontContainer || !envelopeContentContainer) return;
  
  // 添加打开动画
  envelopeFrontContainer.style.opacity = '0';
  envelopeFrontContainer.style.transform = 'scale(0.95)';
  
  setTimeout(() => {
    envelopeFrontContainer.style.display = 'none';
    envelopeContentContainer.style.display = 'flex';
    
    // 检测是否为移动设备（使用全局变量 isIOS）
    const isMobile = isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                     (window.innerWidth <= 768);
    
    // 重置内容区域的滚动位置（在显示容器时立即重置）
    const letterContentArea = document.getElementById('letterContentArea');
    if (letterContentArea) {
      // 使用多种方法确保重置（移动端兼容）
      letterContentArea.scrollTop = 0;
      if (letterContentArea.scrollTo) {
        letterContentArea.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
      
      // 使用 requestAnimationFrame 确保在布局后重置
      requestAnimationFrame(() => {
        letterContentArea.scrollTop = 0;
        if (letterContentArea.scrollTo) {
          letterContentArea.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
        
        // 移动端额外延迟重置
        if (isMobile) {
          setTimeout(() => {
            letterContentArea.scrollTop = 0;
            if (letterContentArea.scrollTo) {
              letterContentArea.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            }
            // 确保第一个段落可见
            const firstParagraph = letterContentArea.querySelector('.letter-content p:first-child');
            if (firstParagraph) {
              firstParagraph.scrollIntoView({ block: 'start', behavior: 'auto' });
              // 再次重置到顶部
              setTimeout(() => {
                letterContentArea.scrollTop = 0;
                if (letterContentArea.scrollTo) {
                  letterContentArea.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                }
              }, 50);
            }
          }, 100);
        }
      });
    }
    
    // 显示信件内容
    showLetterContent();
    
    // 显示并播放音乐
    showMusicRecord();
    
    // 设置背景
    setBackground();
  }, 400);
}

// =================== 显示信件内容 ===================
function showLetterContent() {
  const letterContent = document.getElementById('letterContent');
  let letterText = '';
  
  // 获取信件内容
  if (userConfig.message_type === 'custom' && userConfig.custom_messages) {
    try {
      const customMessages = typeof userConfig.custom_messages === 'string'
        ? JSON.parse(userConfig.custom_messages)
        : userConfig.custom_messages;
      
      if (Array.isArray(customMessages) && customMessages.length > 0) {
        letterText = customMessages[0];
      } else {
        letterText = buildDefaultEnvelopeLetter();
      }
    } catch (e) {
      console.error('解析自定义消息失败:', e);
      letterText = buildDefaultEnvelopeLetter();
    }
  } else {
    letterText = buildDefaultEnvelopeLetter();
  }
  
  // 格式化显示（保留换行）
  letterContent.innerHTML = letterText.split('\n\n').map(para => {
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('');
  
  // 获取内容区域并重置滚动位置到顶部
  const letterContentArea = document.getElementById('letterContentArea');
  
  // iOS Safari: 确保信件内容区域允许文本选择
  if (isIOS && letterContentArea) {
    letterContentArea.style.webkitUserSelect = 'text';
    letterContentArea.style.userSelect = 'text';
    // 确保信件内容本身也可以选择
    if (letterContent) {
      letterContent.style.webkitUserSelect = 'text';
      letterContent.style.userSelect = 'text';
    }
  }
  
  // 在内容设置后立即重置滚动位置（确保第一行可见）
  if (letterContentArea) {
    letterContentArea.scrollTop = 0;
    if (letterContentArea.scrollTo) {
      letterContentArea.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }
  
  // 重置滚动的辅助函数（支持移动端和 iOS）
  function resetScrollPosition(element) {
    if (!element) return;
    
    // iOS Safari 特殊处理
    if (isIOS && isSafari) {
      // iOS Safari: 需要强制设置 scrollTop 多次（iOS 滚动有延迟）
      element.scrollTop = 0;
      
      // iOS Safari: 使用 scrollTo 方法
      if (element.scrollTo) {
        element.scrollTo({
          top: 0,
          left: 0,
          behavior: 'auto'
        });
      }
      
      // iOS Safari: 使用 requestAnimationFrame 确保在渲染后重置
      requestAnimationFrame(() => {
        element.scrollTop = 0;
        if (element.scrollTo) {
          element.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
      });
      
      // iOS Safari: 延迟再次重置（iOS 滚动有惯性）
      setTimeout(() => {
        element.scrollTop = 0;
        if (element.scrollTo) {
          element.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
      }, 100);
    } else {
      // 非 iOS 设备的处理
      // 方法1: 直接设置 scrollTop
      element.scrollTop = 0;
      
      // 方法2: 使用 scrollTo（移动端更可靠）
      if (element.scrollTo) {
        element.scrollTo({
          top: 0,
          left: 0,
          behavior: 'auto' // 立即滚动，不使用平滑滚动
        });
      }
      
      // 方法3: 使用 scrollIntoView（备用方案）- 滚动到第一个段落
      const firstParagraph = element.querySelector('.letter-content p:first-child');
      if (firstParagraph) {
        firstParagraph.scrollIntoView({
          block: 'start',
          inline: 'nearest',
          behavior: 'auto'
        });
      } else if (element.firstElementChild) {
        element.firstElementChild.scrollIntoView({
          block: 'start',
          inline: 'nearest',
          behavior: 'auto'
        });
      }
      
      // 方法4: 再次确保 scrollTop 为 0（双重保险）
      element.scrollTop = 0;
    }
  }
  
  // 保存原始滚动行为（在外部定义以便后续使用）
  let originalScrollBehavior = '';
  if (letterContentArea) {
    // 立即重置滚动位置
    resetScrollPosition(letterContentArea);
    
    // 临时禁用平滑滚动以确保立即重置
    originalScrollBehavior = letterContentArea.style.scrollBehavior || '';
    letterContentArea.style.scrollBehavior = 'auto';
  }
  
  // 添加淡入动画
  setTimeout(() => {
    letterContent.style.opacity = '1';
    letterContent.style.transform = 'translateY(0)';
    
    // 检查是否需要滚动，添加滚动提示
    if (letterContentArea) {
      // 立即重置滚动位置（在动画开始前）
      resetScrollPosition(letterContentArea);
      
      // 再次确保滚动位置在顶部（防止动画影响）
      resetScrollPosition(letterContentArea);
      
      // 使用 requestAnimationFrame 确保在渲染后重置（移动端重要）
      requestAnimationFrame(() => {
        resetScrollPosition(letterContentArea);
        
        // 再次使用 requestAnimationFrame（双重保险）
        requestAnimationFrame(() => {
          resetScrollPosition(letterContentArea);
          
          // 检测是否为移动设备（使用全局变量 isIOS）
          const isMobile = isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                           (window.innerWidth <= 768);
          
          // 等待内容渲染完成（移动端使用更长的延迟）
          const renderDelay = isMobile ? 500 : 300;
          setTimeout(() => {
            // 确保滚动位置在顶部
            resetScrollPosition(letterContentArea);
            
            // 移动端额外重置（确保完全渲染后）
            if (isMobile) {
              requestAnimationFrame(() => {
                resetScrollPosition(letterContentArea);
                // 确保第一个段落可见
                const firstParagraph = letterContentArea.querySelector('.letter-content p:first-child');
                if (firstParagraph) {
                  firstParagraph.scrollIntoView({ block: 'start', behavior: 'auto' });
                }
                setTimeout(() => {
                  resetScrollPosition(letterContentArea);
                  // 再次确保第一个段落可见
                  if (firstParagraph) {
                    firstParagraph.scrollIntoView({ block: 'start', behavior: 'auto' });
                    // 最后重置到顶部
                    setTimeout(() => {
                      letterContentArea.scrollTop = 0;
                      if (letterContentArea.scrollTo) {
                        letterContentArea.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                      }
                    }, 50);
                  }
                }, 100);
              });
            }
            
            // 恢复平滑滚动
            if (letterContentArea.style.scrollBehavior !== undefined) {
              letterContentArea.style.scrollBehavior = originalScrollBehavior || '';
            }
            
            if (letterContentArea.scrollHeight > letterContentArea.clientHeight) {
              letterContentArea.classList.add('has-scroll');
              
              // 添加滚动监听，动态显示/隐藏顶部和底部提示
              letterContentArea.addEventListener('scroll', function() {
                const isAtTop = letterContentArea.scrollTop === 0;
                const isAtBottom = letterContentArea.scrollTop + letterContentArea.clientHeight >= letterContentArea.scrollHeight - 1;
                
                // 根据滚动位置动态添加/移除类
                if (isAtTop) {
                  letterContentArea.classList.remove('scrolled-from-top');
                } else {
                  letterContentArea.classList.add('scrolled-from-top');
                }
                
                if (isAtBottom) {
                  letterContentArea.classList.remove('scrolled-to-bottom');
                } else {
                  letterContentArea.classList.add('scrolled-to-bottom');
                }
              });
              
              // 初始检查
              if (letterContentArea.scrollTop > 0) {
                letterContentArea.classList.add('scrolled-from-top');
              }
            }
          }, renderDelay);
        });
      });
    }
  }, 100);
}

// =================== 获取音乐数据（支持API音乐和内置音乐） ===================
async function fetchMusicData() {
  // 优先使用API音乐
  if (userConfig.music_api_provider && userConfig.music_api_songid) {
    try {
      const response = await fetch(`/api/music-by-songid?provider=${userConfig.music_api_provider}&songid=${userConfig.music_api_songid}`);
      const result = await response.json();
      if (result.success && result.data) {
        return {
          title: result.data.title,
          artist: result.data.artist,
          url: result.data.url,
          pic: result.data.pic,
          isApiMusic: true
        };
      }
    } catch (error) {
      console.error('获取API音乐失败:', error);
    }
  }
  
  // 回退到内置音乐
  if (userConfig.music_url) {
    return {
      title: userConfig.music_title || '背景音乐',
      artist: userConfig.music_artist || '',
      url: userConfig.music_url,
      isApiMusic: false
    };
  }

  if (userConfig.music_id) {
    let result = {
        success: true,
        data: [
            {
                id: 44,
                title: "无人知晓",
                artist: "",
                url: "./asset/无人知晓.m4a",
                // url: "https://mylikecode.oss-cn-shenzhen.aliyuncs.com/music/11_13/%E5%A6%82%E6%9E%9C%E5%8F%AF%E4%BB%A5.mp3",
                backupUrl: "https://mylikecode-two.oss-cn-hangzhou.aliyuncs.com/music/11_13/%E5%A6%82%E6%9E%9C%E5%8F%AF%E4%BB%A5.mp3",
                backupUrl2: "https://mylikecode-three.oss-cn-beijing.aliyuncs.com/music/11_13/%E5%A6%82%E6%9E%9C%E5%8F%AF%E4%BB%A5.mp3",
                allMusicUrls: [
                    "https://mylikecode.oss-cn-shenzhen.aliyuncs.com/music/11_13/%E5%A6%82%E6%9E%9C%E5%8F%AF%E4%BB%A5.mp3",
                    "https://mylikecode-two.oss-cn-hangzhou.aliyuncs.com/music/11_13/%E5%A6%82%E6%9E%9C%E5%8F%AF%E4%BB%A5.mp3",
                    "https://mylikecode-three.oss-cn-beijing.aliyuncs.com/music/11_13/%E5%A6%82%E6%9E%9C%E5%8F%AF%E4%BB%A5.mp3"
                ]
            }
        ]
    }
      if (result.success && result.data && result.data.length > 0) {
        return result.data[0];
      }
  }
  
  return null;
}

// =================== 显示音乐唱片 ===================
async function showMusicRecord() {
  // 检查是否有音乐配置
  const hasMusic = userConfig.music_id || (userConfig.music_api_provider && userConfig.music_api_songid);
  if (!hasMusic) {
    const recordPlayer = document.getElementById('recordPlayer');
    recordPlayer.setAttribute('data-empty', 'true');
    return;
  }
  
  try {
    const music = await fetchMusicData();
    
    if (music) {
      const recordPlayer = document.getElementById('recordPlayer');
      const recordSongTitle = document.getElementById('recordSongTitle');
      const recordSongArtist = document.getElementById('recordSongArtist');
      const recordStatusText = document.getElementById('recordStatusText');
      
      // 更新唱片信息
      recordSongTitle.textContent = music.title || '未知歌曲';
      recordSongArtist.textContent = music.artist || '未知艺术家';
      recordPlayer.setAttribute('data-empty', 'false');
      recordStatusText.textContent = '准备播放';
      
      // 创建音频对象（使用优化的创建函数）
      currentAudio = createAudioElement(music.url);
      currentAudio.volume = 0.5;
      currentAudio.loop = true;
      
      // 设置播放位置
      const playMode = userConfig.play_mode || 'full';
      if (playMode === 'partial' && userConfig.partial_start_time) {
        currentAudio.addEventListener('loadedmetadata', () => {
          if (userConfig.partial_start_time < currentAudio.duration) {
            currentAudio.currentTime = userConfig.partial_start_time;
          }
        });
      }
      
      // 播放音乐（使用带微信浏览器支持的播放函数）
      tryPlayAudio(currentAudio).then(() => {
        recordStatusText.textContent = '正在播放';
        recordPlayer.setAttribute('data-playing', 'true');
        console.log('🎵 音乐播放成功:', music.title);
      }).catch(error => {
        console.warn('音乐自动播放失败，等待用户交互:', error);
        recordStatusText.textContent = '点击播放';
        recordPlayer.setAttribute('data-playing', 'false');
        
        // 添加点击播放功能（iOS 和安卓微信浏览器优化）
        const playOnClick = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          
          // iOS Safari: 如果音频未加载，先加载
          if (isIOS && isSafari && currentAudio.readyState === 0) {
            console.log('📱 iOS: 用户点击播放，先加载音频');
            currentAudio.load();
          }
          
          // 用户交互时直接播放（标记为用户交互）
          tryPlayAudio(currentAudio, true).then(() => {
            recordStatusText.textContent = '正在播放';
            recordPlayer.setAttribute('data-playing', 'true');
            console.log('🎵 用户交互后音乐播放成功:', music.title);
          }).catch(err => {
            console.error('用户交互后播放失败:', err);
            recordStatusText.textContent = '播放失败，请重试';
            // 保留点击功能，允许重试
          });
          
          // 移除事件监听器（只移除一次性的）
          recordPlayer.removeEventListener('click', playOnClick);
          recordPlayer.removeEventListener('touchstart', playOnClick);
        };
        
        // 添加点击事件（iOS 优先使用 touchstart）
        recordPlayer.style.cursor = 'pointer';
        recordPlayer.style.touchAction = 'manipulation'; // 优化触摸响应
        // iOS 需要 -webkit-tap-highlight-color 来优化点击反馈
        if (isIOS) {
          recordPlayer.style.webkitTapHighlightColor = 'rgba(0, 0, 0, 0.1)';
        }
        recordPlayer.addEventListener('touchstart', playOnClick, { once: true, passive: false });
        recordPlayer.addEventListener('click', playOnClick, { once: true, passive: false });
      });
      
      // 添加旋转动画
      const disc = recordPlayer.querySelector('[data-role="disc"]');
      if (disc) {
        disc.style.animation = 'spin 3s linear infinite';
      }
    }
  } catch (error) {
    console.error('获取音乐失败:', error);
  }
}

// =================== 扫描后继续 ===================
function continueAfterScan() {
  // 设置背景
  setBackground();
  
  // 播放音乐
  playMusic();
  
  
  // 开始弹窗
  startPopups();
}

// =================== 信纸样式配置 ===================
const letterPaperMap = {
  classic: { themeClass: 'paper-theme-classic' },
  lavender: { themeClass: 'paper-theme-lavender' },
  sky: { themeClass: 'paper-theme-sky' },
  mint: { themeClass: 'paper-theme-mint' },
  sunset: { themeClass: 'paper-theme-sunset' },
  midnight: { themeClass: 'paper-theme-midnight' }
};

const letterPaperThemeClasses = [
  'paper-theme-classic',
  'paper-theme-lavender',
  'paper-theme-sky',
  'paper-theme-mint',
  'paper-theme-sunset',
  'paper-theme-midnight'
];

// 清除信纸样式
function clearLetterPaperTheme() {
  letterPaperThemeClasses.forEach(cls => {
    document.body.classList.remove(cls);
  });
}

// 应用信纸样式
function applyLetterPaperTheme(paperId) {
  clearLetterPaperTheme();
  if (paperId && letterPaperMap[paperId]) {
    document.body.classList.add(letterPaperMap[paperId].themeClass);
  }
}

// =================== 设置背景 ===================
function setBackground() {
  const background = userConfig.background;
  const customBackgroundImage = userConfig.custom_background_image;
  const shape = userConfig.shape || 'square';
  
  // 清除之前的信纸样式
  clearLetterPaperTheme();
  
  // 清除信件内容区域的信纸样式类
  const letterContentArea = document.getElementById('letterContentArea');
  if (letterContentArea) {
    letterPaperThemeClasses.forEach(cls => {
      letterContentArea.classList.remove(cls);
    });
  }
  
  if (background === 'custom' && customBackgroundImage) {
    // 自定义背景图片
    document.body.style.backgroundImage = `url(${customBackgroundImage})`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundAttachment = 'fixed';
  } else if (shape === 'envelope' && userConfig.letter_paper) {
    // 信封模式且选择了信纸样式，应用信纸样式
    applyLetterPaperTheme(userConfig.letter_paper);
    document.body.style.backgroundImage = '';
    
    // 同时给信件内容区域添加信纸样式类
    if (letterContentArea && letterPaperMap[userConfig.letter_paper]) {
      letterContentArea.classList.add(letterPaperMap[userConfig.letter_paper].themeClass);
    }
  } else {
    // 默认白色背景
    document.body.style.background = 'white';
    document.body.style.backgroundImage = '';
  }
}

// =================== 播放音乐 ===================
async function playMusic() {
  const hasMusic = userConfig.music_id || (userConfig.music_api_provider && userConfig.music_api_songid);
  if (!hasMusic) {
    console.log('未配置音乐');
    return;
  }
  
  try {
    const music = await fetchMusicData();
    
    if (music && music.url) {
      // 创建音频对象（使用优化的创建函数）
      currentAudio = createAudioElement(music.url);
      currentAudio.volume = 0.5;
      currentAudio.loop = true;
      
      // 设置播放位置
      const playMode = userConfig.play_mode || 'full';
      if (playMode === 'partial' && userConfig.partial_start_time) {
        currentAudio.addEventListener('loadedmetadata', () => {
          if (userConfig.partial_start_time < currentAudio.duration) {
            currentAudio.currentTime = userConfig.partial_start_time;
          }
        });
      }
      
      // 播放音乐（使用带微信浏览器支持的播放函数）
      tryPlayAudio(currentAudio).then(() => {
        console.log('🎵 音乐播放成功:', music.title);
      }).catch(error => {
        console.warn('音乐自动播放失败，等待用户交互:', error);
        
        // 在用户交互后重试播放（安卓微信浏览器优化）
        const retryPlay = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          
          // 用户交互时直接播放（标记为用户交互）
          tryPlayAudio(currentAudio, true).then(() => {
            console.log('🎵 用户交互后音乐播放成功:', music.title);
          }).catch(err => {
            console.error('用户交互后播放失败:', err);
          });
          
          // 移除事件监听器
          document.removeEventListener('touchstart', retryPlay);
          document.removeEventListener('touchend', retryPlay);
          document.removeEventListener('click', retryPlay);
        };
        
        // 监听用户交互（安卓优先使用 touchstart）
        document.addEventListener('touchstart', retryPlay, { once: true, passive: false });
        document.addEventListener('touchend', retryPlay, { once: true, passive: false });
        document.addEventListener('click', retryPlay, { once: true, passive: false });
      });
    }
  } catch (error) {
    console.error('获取音乐失败:', error);
  }
}


// =================== 开始弹窗 ===================
function startPopups() {
  isPlaying = true;
  
  const shape = userConfig.shape || 'square';
  let messages = [];
  
  // 根据形状处理消息
  if (shape === 'envelope') {
    // 信封模式：显示信件内容
    if (userConfig.message_type === 'custom' && userConfig.custom_messages) {
      try {
        const customMessages = JSON.parse(userConfig.custom_messages);
        // 检查是否有有效的自定义信件内容
        const hasEnvelopeCustomContent = Array.isArray(customMessages)
          && customMessages.length > 0
          && typeof customMessages[0] === 'string'
          && customMessages[0].trim() !== '';
        
        if (hasEnvelopeCustomContent) {
          // 使用自定义信件内容（整封信作为一个消息）
          messages = customMessages;
        } else {
          // 使用默认信件模板
          messages = [buildDefaultEnvelopeLetter()];
        }
      } catch (e) {
        console.error('解析自定义消息失败:', e);
        messages = [buildDefaultEnvelopeLetter()];
      }
    } else {
      // 使用默认信件模板
      messages = [buildDefaultEnvelopeLetter()];
    }
  } else {
    // 方框模式：显示多条提醒消息
    if (userConfig.message_type === 'custom' && userConfig.custom_messages) {
      try {
        const customMessages = typeof userConfig.custom_messages === 'string'
          ? JSON.parse(userConfig.custom_messages)
          : userConfig.custom_messages;
        // 方框模式：1-200 条自定义消息即可生效
        if (Array.isArray(customMessages) && customMessages.length >= 1 && customMessages.length <= 200) {
          messages = customMessages;
        } else {
          messages = getDefaultMessages();
        }
      } catch (e) {
        console.error('解析自定义消息失败:', e);
        messages = getDefaultMessages();
      }
    } else {
      messages = getDefaultMessages();
    }
  }
  
  // 获取弹窗速度
  const windowSpeed = userConfig.window_speed || 600;
  
  // 开始循环显示弹窗
  showNextPopup(messages, 0, windowSpeed);
}

// =================== 构建默认信件内容 ===================
function buildDefaultEnvelopeLetter() {
  const friendName = userConfig.friend_name || '朋友';
  const letterParagraphs = [
    `亲爱的${friendName}：`,
    '最近的日子一定有些忙碌吧？我总担心你会为了照顾世界而忘了照顾自己。',
    '请记得按时吃饭，把休息当作重要的安排；委屈的时候就告诉我，我会第一时间拥抱你。',
    '如果觉得累，就给自己放个小假，去感受一点阳光、风和喜欢的音乐。慢慢来，你不需要完美。',
    '我永远站在你这边，提醒你：你真的很棒，也值得被温柔对待。',
    '永远支持你的朋友'
  ];
  return letterParagraphs.join('\n\n');
}

// =================== 显示下一个弹窗 ===================
function showNextPopup(messages, index, speed) {
  if (!isPlaying) return;
  
  // 循环播放
  if (index >= messages.length) {
    index = 0;
  }
  
  currentMessageIndex = index;
  createPopup(messages[index]);
  
  const timeout = setTimeout(() => {
    showNextPopup(messages, index + 1, speed);
  }, speed);
  
  popupTimeouts.push(timeout);
}

// =================== 创建弹窗 ===================
function createPopup(message) {
  const popup = document.createElement('div');
  
  // 根据形状设置类名
  const shape = userConfig.shape || 'square';
  popup.className = shape === 'envelope' ? 'popup popup-envelope' : 'popup popup-square';
  
  // 设置样式
  const { bgColor, textColor } = getPopupColors();
  
  if (shape === 'envelope') {
    const envelopeColor = getEnvelopeColor();
    popup.style.background = `rgba(${hexToRgb(envelopeColor.base)}, 0.9)`;
    popup.style.border = `2px solid ${envelopeColor.border}`;
    popup.style.color = envelopeColor.textColor;
    popup.style.setProperty('--envelope-flap', envelopeColor.flap);
  } else {
    // 方框透明度：从配置读取（默认0.3，范围0.1-1.0）
    const raw = Number(userConfig.square_opacity);
    const alpha = Number.isFinite(raw) ? Math.min(1, Math.max(0.1, raw)) : 0.3;
    // 自定义颜色优先
    const customHex = typeof userConfig.square_custom_color === 'string' ? userConfig.square_custom_color : '';
    if (customHex && /^#([0-9a-fA-F]{6})$/.test(customHex)) {
      const txt = getLuminance(customHex) > 0.6 ? '#111111' : '#ffffff';
      popup.style.background = `rgba(${hexToRgb(customHex)}, ${alpha})`;
      popup.style.color = txt;
    } else {
      popup.style.background = `rgba(${hexToRgb(bgColor)}, ${alpha})`;
      popup.style.color = textColor;
    }
  }
  
  popup.style.backdropFilter = 'blur(10px)';
  popup.style.webkitBackdropFilter = 'blur(10px)';
  
  // 创建内容
  const friendName = userConfig.friend_name || '朋友';
  const isEnvelopeShape = shape === 'envelope';
  popup.innerHTML = `
    <div class="popup-name-tag">${friendName}</div>
    <div class="popup-text" style="text-align: ${isEnvelopeShape ? 'left' : 'center'}; white-space: pre-line;">${message}</div>
  `;
  
  // 设置位置
  popup.style.position = 'fixed';
  popup.style.zIndex = popupZIndexCursor++;
  popup.style.visibility = 'hidden';
  document.body.appendChild(popup);
  
  // 计算随机位置
  const rect = popup.getBoundingClientRect();
  const maxX = Math.max(0, window.innerWidth - rect.width);
  const maxY = Math.max(0, window.innerHeight - rect.height);
  const x = Math.random() * maxX;
  const y = Math.random() * maxY;
  
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  popup.style.visibility = 'visible';
  
  // 添加动画
  requestAnimationFrame(() => popup.classList.add('show'));
  
  // 点击关闭（安卓微信浏览器优化）
  const handlePopupClose = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // 在用户点击后，如果是微信浏览器，尝试启用音频播放
    if (isWeChatBrowser && !audioPlayEnabled && typeof WeixinJSBridge !== 'undefined') {
      enableAudioPlay();
      // 如果音频已创建但未播放，尝试播放（用户交互触发）
      if (currentAudio && currentAudio.paused) {
        tryPlayAudio(currentAudio, true).catch(() => {});
      }
    }
    
    // iOS Safari: 用户交互后，如果音频未加载，先加载
    if (isIOS && isSafari && currentAudio && currentAudio.readyState === 0) {
      console.log('📱 iOS: 用户交互后加载音频');
      currentAudio.load();
      // 尝试播放
      if (currentAudio.paused) {
        tryPlayAudio(currentAudio, true).catch(() => {});
      }
    }
    
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => popup.remove(), 600);
  };
  
  popup.addEventListener('touchstart', handlePopupClose, { passive: false });
  popup.addEventListener('click', handlePopupClose, { passive: false });
  
  // 自动消失
  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => popup.remove(), 600);
  }, 15000);
}

// =================== 获取弹窗颜色 ===================
function getPopupColors() {
  const colorTheme = userConfig.color || 'random';
  const colorThemes = {
    random: [
      '#FFE5E5', '#FFD6E5', '#FFCCE5', '#FFE5F0', '#FFD6F0',
      '#FFCCF0', '#FFE0E8', '#FFD8EA', '#FFC9E3', '#FFEEF3',
      '#E5F0FF', '#D6F0FF', '#CCF0FF', '#E5FFFF', '#D6FFFF',
      '#CCFFFF', '#E8F4FF', '#D4EDFF', '#C9E8FF', '#EBF5FF',
      '#FFFFE5', '#FFFFD6', '#FFFFCC', '#FFF0E5', '#FFE5D6',
      '#FFECC9', '#FFF9E0', '#FFF4D4', '#FFEFC9', '#FFFBEB',
      '#E5FFE5', '#D6FFE5', '#CCFFE5', '#F0FFE5', '#E5FFD6',
      '#D6FFCC', '#E8FFE8', '#D4FFDE', '#C9FFD4', '#EBFFEB',
      '#E5E5FF', '#D6D6FF', '#CCCCFF', '#FFE5FF', '#FFD6FF',
      '#F3E5FF', '#EBD6FF', '#E4CCFF', '#F8E8FF', '#F0DBFF'
    ],
    pink: ['#FFE5E5', '#FFD6E5', '#FFCCE5', '#FFE5F0', '#FFD6F0'],
    blue: ['#E5F0FF', '#D6F0FF', '#CCF0FF', '#E5FFFF', '#D6FFFF'],
    yellow: ['#FFFFE5', '#FFFFD6', '#FFFFCC', '#FFF0E5', '#FFE5D6'],
    green: ['#E5FFE5', '#D6FFE5', '#CCFFE5', '#F0FFE5', '#E5FFD6'],
    purple: ['#E5E5FF', '#D6D6FF', '#CCCCFF', '#FFE5FF', '#FFD6FF']
  };
  
  const colors = colorThemes[colorTheme] || colorThemes.random;
  const bgColor = colors[Math.floor(Math.random() * colors.length)];
  const textColor = getLuminance(bgColor) > 0.6 ? '#111111' : '#ffffff';
  
  return { bgColor, textColor };
}

// =================== 获取信封颜色 ===================
function getEnvelopeColor() {
  const envelopeColors = {
    kraft: { base: '#D4A574', flap: '#C89968', border: '#B8895C', textColor: '#5D4037' },
    white: { base: '#FFFFFF', flap: '#F5F5F5', border: '#E0E0E0', textColor: '#333333' },
    pink: { base: '#FFE5EA', flap: '#FFD0DB', border: '#FFB8C8', textColor: '#D81B60' },
    blue: { base: '#E3F2FD', flap: '#BBDEFB', border: '#90CAF9', textColor: '#1565C0' },
    purple: { base: '#F3E5F5', flap: '#E1BEE7', border: '#CE93D8', textColor: '#6A1B9A' },
    mint: { base: '#E0F2F1', flap: '#B2DFDB', border: '#80CBC4', textColor: '#00695C' },
    peach: { base: '#FFF3E0', flap: '#FFE0B2', border: '#FFCC80', textColor: '#E65100' },
    lavender: { base: '#EDE7F6', flap: '#D1C4E9', border: '#B39DDB', textColor: '#4527A0' }
  };
  
  const colorKey = userConfig.envelope_color || 'kraft';
  return envelopeColors[colorKey] || envelopeColors.kraft;
}

// =================== 工具函数 ===================
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function getLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function getDefaultMessages() {
  return [
    "记得多喝水哦", "今天也要开心", "不要太辛苦了", "累了就休息一下",
    "你很重要", "相信你可以的", "加油，我在你身边", "别担心，一切都会好的",
    "你值得被温柔对待", "保重身体", "记得按时吃饭", "早点休息",
    "别给自己太大压力", "慢慢来，不着急", "你已经做得很好了", "记得照顾好自己",
    "困难只是暂时的", "明天会更好", "你不是一个人", "有我陪着你",
    "遇到困难记得找我", "你的努力我都看到了", "不开心就和我说", "我会一直支持你",
    "你很棒", "相信自己", "给自己一个拥抱", "今天的你也很可爱",
    "记得微笑", "别忘了你的梦想", "慢慢来就好", "不要太勉强自己",
    "心情不好就出去走走", "晒晒太阳", "听听喜欢的音乐", "做自己喜欢的事",
    "允许自己偶尔放松", "你的感受很重要", "不要忽视自己的需要", "学会说不",
    "保护好自己", "你值得被爱", "记得你有多珍贵", "今天也辛苦了",
    "谢谢你这么努力", "看到你的进步真开心", "为你感到骄傲", "你的存在就是意义"
  ];
}

// =================== 快捷键 ===================
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // 清除所有弹窗
    popupTimeouts.forEach(t => clearTimeout(t));
    popupTimeouts.length = 0;
    document.querySelectorAll('.popup').forEach(popup => popup.remove());
    isPlaying = false;
  }
});

