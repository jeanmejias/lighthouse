/**
 * @license Copyright 2016 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
// @ts-nocheck
'use strict';

const NBSP = '\xa0';

/**
 * Nexus 5X metrics adapted from emulated_devices/module.json
 */
const NEXUS5X_EMULATION_METRICS = {
  mobile: true,
  screenWidth: 412,
  screenHeight: 732,
  width: 412,
  height: 732,
  positionX: 0,
  positionY: 0,
  scale: 1,
  deviceScaleFactor: 2.625,
  fitWindow: false,
  screenOrientation: {
    angle: 0,
    type: 'portraitPrimary',
  },
};

const NEXUS5X_USERAGENT = {
  userAgent: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5 Build/MRA58N) AppleWebKit/537.36' +
    '(KHTML, like Gecko) Chrome/66.0.3359.30 Mobile Safari/537.36',
};

/**
 * Adjustments needed for DevTools network throttling to simulate
 * more realistic network conditions.
 * See: crbug.com/721112
 */
const LATENCY_FACTOR = 3.75;
const THROUGHPUT_FACTOR = 0.9;

const TARGET_LATENCY = 150; // 150ms
const TARGET_DOWNLOAD_THROUGHPUT = Math.floor(1.6 * 1024 * 1024 / 8); // 1.6Mbps
const TARGET_UPLOAD_THROUGHPUT = Math.floor(750 * 1024 / 8); // 750Kbps

const TYPICAL_MOBILE_THROTTLING_METRICS = {
  targetLatency: TARGET_LATENCY,
  latency: TARGET_LATENCY * LATENCY_FACTOR,
  targetDownloadThroughput: TARGET_DOWNLOAD_THROUGHPUT,
  downloadThroughput: TARGET_DOWNLOAD_THROUGHPUT * THROUGHPUT_FACTOR,
  targetUploadThroughput: TARGET_UPLOAD_THROUGHPUT,
  uploadThroughput: TARGET_UPLOAD_THROUGHPUT * THROUGHPUT_FACTOR,
  offline: false,
};

const OFFLINE_METRICS = {
  offline: true,
  // values of 0 remove any active throttling. crbug.com/456324#c9
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
};

const NO_THROTTLING_METRICS = {
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
  offline: false,
};

const NO_CPU_THROTTLE_METRICS = {
  rate: 1,
};
const CPU_THROTTLE_METRICS = {
  rate: 4,
};

function enableNexus5X(driver) {
  // COMPAT FIMXE
  // Injecting this function clientside is no longer neccessary as of m62. This is done
  // on the backend when `Emulation.setTouchEmulationEnabled` is set.
  //   https://bugs.chromium.org/p/chromium/issues/detail?id=133915#c63
  // Once m62 hits stable (~Oct 20th) we can nuke this entirely
  /**
   * Finalizes touch emulation by enabling `"ontouchstart" in window` feature detect
   * to work. Messy hack, though copied verbatim from DevTools' emulation/TouchModel.js
   * where it's been working for years. addScriptToEvaluateOnLoad runs before any of the
   * page's JavaScript executes.
   */
  /* eslint-disable no-proto */ /* global window, document */ /* istanbul ignore next */
  const injectedTouchEventsFunction = function() {
    const touchEvents = ['ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel'];
    const recepients = [window.__proto__, document.__proto__];
    for (let i = 0; i < touchEvents.length; ++i) {
      for (let j = 0; j < recepients.length; ++j) {
        if (!(touchEvents[i] in recepients[j])) {
          Object.defineProperty(recepients[j], touchEvents[i], {
            value: null, writable: true, configurable: true, enumerable: true,
          });
        }
      }
    }
  };
  /* eslint-enable */

  return Promise.all([
    driver.sendCommand('Emulation.setDeviceMetricsOverride', NEXUS5X_EMULATION_METRICS),
    // Network.enable must be called for UA overriding to work
    driver.sendCommand('Network.enable'),
    driver.sendCommand('Network.setUserAgentOverride', NEXUS5X_USERAGENT),
    driver.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      configuration: 'mobile',
    }),
    driver.sendCommand('Page.addScriptToEvaluateOnLoad', {
      scriptSource: '(' + injectedTouchEventsFunction.toString() + ')()',
    }),
  ]);
}

/**
 * @param {Driver} driver
 * @param {LH.ThrottlingSettings|undefined} throttlingSettings
 * @return {Promise<void>}
 */
function enableNetworkThrottling(driver, throttlingSettings) {
  let conditions = TYPICAL_MOBILE_THROTTLING_METRICS;
  if (throttlingSettings) {
    conditions = {
      offline: false,
      latency: throttlingSettings.requestLatency,
      downloadThroughput: throttlingSettings.downloadThroughput / 8,
      uploadThroughput: throttlingSettings.uploadThroughput / 8,
    };
  }

  return driver.sendCommand('Network.emulateNetworkConditions', conditions);
}

function disableNetworkThrottling(driver) {
  return driver.sendCommand('Network.emulateNetworkConditions', NO_THROTTLING_METRICS);
}

function goOffline(driver) {
  return driver.sendCommand('Network.emulateNetworkConditions', OFFLINE_METRICS);
}

/**
 * @param {Driver} driver
 * @param {LH.ThrottlingSettings|undefined} throttlingSettings
 * @return {Promise<void>}
 */
function enableCPUThrottling(driver, throttlingSettings) {
  const rate = throttlingSettings
    ? throttlingSettings.cpuSlowdownMultiplier
    : CPU_THROTTLE_METRICS.rate;
  return driver.sendCommand('Emulation.setCPUThrottlingRate', {rate});
}

function disableCPUThrottling(driver) {
  return driver.sendCommand('Emulation.setCPUThrottlingRate', NO_CPU_THROTTLE_METRICS);
}

/**
 * @param {LH.ConfigSettings} settings
 * @return {deviceEmulation: string, cpuThrottling: string, networkThrottling: string}
 */
function getEmulationDesc(settings) {
  let cpuThrottling;
  let networkThrottling;
  const byteToKbit = bytes => (bytes / 1024 * 8).toFixed();

  switch (settings.throttlingMethod) {
    case 'provided':
      cpuThrottling = 'Provided by environment';
      networkThrottling = 'Provided by environment';
      break;
    case 'devtools': {
      const {cpuSlowdownMultiplier, requestLatency} = settings.throttling;
      const down = byteToKbit(settings.throttling.downloadThroughput);
      const up = byteToKbit(settings.throttling.uploadThroughput);

      cpuThrottling = `${cpuSlowdownMultiplier}x slowdown (DevTools)`;
      networkThrottling = `${requestLatency}${NBSP}ms HTTP RTT, ` +
        `${down}${NBSP}Kbps down, ${up}${NBSP}Kbps up (DevTools)`;
      break;
    }
    case 'simulate': {
      const {cpuSlowdownMultiplier, rtt} = settings.throttling;
      const throughput = byteToKbit(settings.throttling.throughput);
      cpuThrottling = `${cpuSlowdownMultiplier}x slowdown (Simulated)`;
      networkThrottling = `${rtt}${NBSP}ms TCP RTT, ` +
        `${throughput}${NBSP}Kbps throughput (Simulated)`;
      break;
    }
  }

  return {
    deviceEmulation: settings.disableDeviceEmulation ? 'Disabled' : 'Nexus 5X',
    cpuThrottling,
    networkThrottling,
  };
}

module.exports = {
  enableNexus5X,
  enableNetworkThrottling,
  disableNetworkThrottling,
  enableCPUThrottling,
  disableCPUThrottling,
  goOffline,
  getEmulationDesc,
  settings: {
    NEXUS5X_EMULATION_METRICS,
    NEXUS5X_USERAGENT,
    TYPICAL_MOBILE_THROTTLING_METRICS,
    OFFLINE_METRICS,
    NO_THROTTLING_METRICS,
    NO_CPU_THROTTLE_METRICS,
    CPU_THROTTLE_METRICS,
  },
};
