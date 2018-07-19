const path = require('path');
const fs = require('fs-extra');

module.exports = api => {
  api.addClientAddon({
    id: 'org.vueneue.webpack.client-addon',
    path: path.join(__dirname, 'ui-addon-dist'),
    // url: 'http://localhost:8042/index.js',
  });

  const { getSharedData, setSharedData, removeSharedData } = api.namespace(
    'org.vue.webpack.',
  );

  let firstRun = true;
  let hadFailed = false;

  function resetSharedData(key) {
    setSharedData(`${key}-status`, null);
    setSharedData(`${key}-progress`, 0);
    setSharedData(`${key}-operations`, null);
    setSharedData(`${key}-stats`, null);
    setSharedData(`${key}-sizes`, null);
    setSharedData(`${key}-problems`, null);
  }

  async function onWebpackMessage({ data: message }) {
    if (message.webpackDashboardData) {
      const modernMode = getSharedData('modern-mode').value;
      const type = message.webpackDashboardData.type;

      for (const data of message.webpackDashboardData.value) {
        const id = `${type}-${data.type}`;

        if (data.type === 'stats') {
          // Stats are read from a file
          const statsFile = path.resolve(
            process.cwd(),
            `./node_modules/.stats-${type}.json`,
          );
          const value = await fs.readJson(statsFile);
          setSharedData(id, value);
          await fs.remove(statsFile);
        } else if (data.type === 'progress') {
          if (type === 'serve' || !modernMode) {
            setSharedData(id, {
              [type]: data.value,
            });
          } else {
            // Display two progress bars
            const progress = getSharedData(id).value;
            progress[type] = data.value;
            for (const t of ['build', 'build-modern']) {
              setSharedData(`${t}-${data.type}`, {
                build: progress.build || 0,
                'build-modern': progress['build-modern'] || 0,
              });
            }
          }
        } else {
          // Don't display success until both build and build-modern are done
          if (
            type !== 'serve' &&
            modernMode &&
            data.type === 'status' &&
            data.value === 'Success'
          ) {
            if (type === 'build-modern') {
              for (const t of ['build', 'build-modern']) {
                setSharedData(`${t}-status`, data.value);
              }
            }
          } else {
            setSharedData(id, data.value);
          }

          // Notifications
          if (type === 'serve' && data.type === 'status') {
            if (data.value === 'Failed') {
              api.notify({
                title: 'Build failed',
                message: 'The build has errors.',
                icon: 'error',
              });
              hadFailed = true;
            } else if (data.value === 'Success') {
              if (hadFailed) {
                api.notify({
                  title: 'Build fixed',
                  message: 'The build succeeded.',
                  icon: 'done',
                });
                hadFailed = false;
              } else if (firstRun) {
                api.notify({
                  title: 'App ready',
                  message: 'The build succeeded.',
                  icon: 'done',
                });
                firstRun = false;
              }
            }
          }
        }
      }
    }
  }

  // Init data
  api.onProjectOpen(() => {
    for (const key of ['ssr-serve', 'ssr-build']) {
      resetSharedData(key);
    }
  });

  // Tasks
  const views = {
    views: [
      {
        id: 'org.vueneue.webpack.views.dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        component: 'org.vueneue.webpack.components.dashboard',
      },
      {
        id: 'org.vueneue.webpack.views.analyzer',
        label: 'Analyzer',
        icon: 'donut_large',
        component: 'org.vueneue.webpack.components.analyzer',
      },
    ],
    defaultView: 'org.vueneue.webpack.views.dashboard',
  };

  api.describeTask({
    match: /vue-cli-service ssr:serve/,
    description: 'SSR: Start development server with HMR',
    prompts: [
      {
        name: 'mode',
        type: 'list',
        default: 'development',
        choices: [
          {
            name: 'development',
            value: 'development',
          },
          {
            name: 'production',
            value: 'production',
          },
          {
            name: 'test',
            value: 'test',
          },
        ],
        description: 'Specify env',
      },
      {
        name: 'host',
        type: 'input',
        default: '127.0.0.1',
        description: 'Specify host',
      },
      {
        name: 'port',
        type: 'input',
        default: 8080,
        description: 'Specify port',
      },
    ],
    onBeforeRun: ({ answers, args }) => {
      // Args
      if (answers.mode) args.push('--mode', answers.mode);
      if (answers.host) args.push('--host', answers.host);
      if (answers.port) args.push('--port', answers.port);
      args.push('--dashboard');

      // Data
      removeSharedData('serve-url');
      resetSharedData('serve', true);
      firstRun = true;
      hadFailed = false;
    },
    onRun: () => {
      api.ipcOn(onWebpackMessage);
    },
    onExit: () => {
      api.ipcOff(onWebpackMessage);
      removeSharedData('serve-url');
    },
    ...views,
  });

  api.describeTask({
    match: /vue-cli-service ssr:build/,
    description: 'SSR: Make a production build',
    prompts: [
      {
        name: 'mode',
        type: 'list',
        default: 'production',
        choices: [
          {
            name: 'development',
            value: 'development',
          },
          {
            name: 'production',
            value: 'production',
          },
          {
            name: 'test',
            value: 'test',
          },
        ],
        description: 'Specify env',
      },
      {
        name: 'report',
        type: 'confirm',
        default: false,
        description: 'Generate report files',
      },
      {
        name: 'watch',
        type: 'confirm',
        default: false,
        description: 'Enable watch mode',
      },
    ],
    onBeforeRun: ({ answers, args }) => {
      // Args
      if (answers.mode) args.push('--mode', answers.mode);
      if (answers.report) args.push('--report', answers.report);
      if (answers.watch) args.push('--watch', answers.watch);
      args.push('--dashboard');

      // Data
      resetSharedData('ssr-build', true);
    },
    onRun: () => {
      api.ipcOn(onWebpackMessage);
    },
    onExit: () => {
      api.ipcOff(onWebpackMessage);
    },
    ...views,
  });

  api.describeTask({
    match: /vue-cli-service ssr:start/,
    description: 'SSR: Start production server',
    prompts: [
      {
        name: 'mode',
        type: 'list',
        default: 'production',
        choices: [
          {
            name: 'development',
            value: 'development',
          },
          {
            name: 'production',
            value: 'production',
          },
          {
            name: 'test',
            value: 'test',
          },
        ],
        description: 'Specify env',
      },
      {
        name: 'host',
        type: 'input',
        default: '0.0.0.0',
        description: 'Specify host',
      },
      {
        name: 'port',
        type: 'input',
        default: 8080,
        description: 'Specify port',
      },
    ],
    onBeforeRun: ({ answers, args }) => {
      // Args
      if (answers.mode) args.push('--mode', answers.mode);
      if (answers.host) args.push('--host', answers.host);
      if (answers.port) args.push('--port', answers.port);
    },
  });

  api.describeTask({
    match: /vue-cli-service generate/,
    description: 'Generate static website',
  });

  // Open app button
  api.ipcOn(({ data }) => {
    if (data.vueServe) {
      setSharedData('serve-url', data.vueServe.url);
    }
  });
};
