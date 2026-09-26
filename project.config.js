module.exports = {
  port: 3912,
  title: '钟乳石洞穴微环境巡测',
  lede: '围绕洞穴、分区、样点和巡测路线记录微环境数据，发现异常后生成复查闭环。',
  tones: {
    '常规观察': 'ok',
    '正常': 'ok',
    '已复查': 'ok',
    '复查达标': 'ok',
    '复查仍超标': 'bad',
    '重点保护': 'warn',
    '异常待复查': 'bad',
    '暂停开放': 'bad'
  },
  collections: {
    sites: { label: '样点档案' },
    surveys: { label: '巡测记录' }
  },
  stats: [
    { label: '样点', collection: 'sites' },
    { label: '重点保护', collection: 'sites', filter: { field: 'protectedStatus', value: '重点保护' } },
    { label: '巡测记录', collection: 'surveys' },
    { label: '待复查', collection: 'surveys', filter: { field: 'status', value: '异常待复查' } },
    { label: '复查仍超标', collection: 'surveys', filter: { field: 'reviewResult', value: '复查仍超标' } }
  ],
  views: [
    {
      id: 'dashboard',
      label: '趋势看板',
      type: 'dashboard',
      focusTitle: '异常与复查',
      focus: { collection: 'surveys', field: 'status', values: ['异常待复查', '已复查'], limit: 8 }
    },
    {
      id: 'sites',
      label: '样点档案',
      collection: 'sites',
      formTitle: '新增样点',
      listTitle: '样点列表',
      submitLabel: '保存样点',
      searchPlaceholder: '搜索洞穴、分区、样点、路线',
      searchFields: ['cave', 'zone', 'pointCode', 'route'],
      statusField: 'protectedStatus',
      statusOptions: ['常规观察', '重点保护', '暂停开放'],
      titleFields: ['pointCode', 'zone'],
      summaryFields: ['note'],
      detailFields: [
        { label: '洞穴', name: 'cave' },
        { label: '巡测路线', name: 'route' },
        { label: '敏感等级', name: 'sensitivity' }
      ],
      fields: [
        { label: '洞穴', name: 'cave', required: true },
        { label: '分区', name: 'zone', required: true },
        { label: '样点编号', name: 'pointCode', required: true },
        { label: '巡测路线', name: 'route', required: true },
        { label: '敏感等级', name: 'sensitivity', type: 'select', options: ['低', '中', '高'] },
        { label: '保护状态', name: 'protectedStatus', type: 'select', options: ['常规观察', '重点保护', '暂停开放'] },
        { label: '基准温度', name: 'baselineTemp', type: 'number', step: 'any', required: true },
        { label: '基准湿度', name: 'baselineHumidity', type: 'number', step: 'any', required: true },
        { label: '基准CO2', name: 'baselineCo2', type: 'number', step: 'any', required: true },
        { label: '备注', name: 'note', type: 'textarea', wide: true }
      ]
    },
    {
      id: 'surveys',
      label: '巡测记录',
      collection: 'surveys',
      formTitle: '登记巡测',
      listTitle: '巡测历史',
      submitLabel: '保存巡测',
      searchPlaceholder: '搜索人员、干扰痕迹、照片',
      searchFields: ['surveyor', 'disturbance', 'photoUrl'],
      statusField: 'status',
      statusOptions: ['正常', '异常待复查', '已复查'],
      titleFields: ['surveyor', 'date'],
      relation: { collection: 'sites', localKey: 'siteId', labelFields: ['cave', 'zone', 'pointCode'] },
      pillFields: ['reviewResult'],
      summaryFields: ['disturbance', 'reviewNote'],
      detailFields: [
        { label: '温度', name: 'temperature' },
        { label: '湿度', name: 'humidity' },
        { label: 'CO2', name: 'co2' },
        { label: '复查人', name: 'reviewer', optional: true },
        { label: '复查温度(℃)', name: 'reviewTemp', optional: true },
        { label: '复查湿度(%)', name: 'reviewHumidity', optional: true },
        { label: '复查CO2(ppm)', name: 'reviewCo2', optional: true }
      ],
      defaults: { status: '正常', reviewNote: '' },
      fields: [
        { label: '样点', name: 'siteId', type: 'relation', collection: 'sites', labelFields: ['cave', 'zone', 'pointCode'], required: true, wide: true },
        { label: '巡测人员', name: 'surveyor', required: true },
        { label: '日期', name: 'date', type: 'date', required: true },
        { label: '温度', name: 'temperature', type: 'number', step: 'any', required: true },
        { label: '湿度', name: 'humidity', type: 'number', step: 'any', required: true },
        { label: 'CO2', name: 'co2', type: 'number', step: 'any', required: true },
        { label: '滴水频率', name: 'dripRate', type: 'number', step: 'any', required: true },
        { label: '照片链接', name: 'photoUrl' },
        { label: '游客干扰痕迹', name: 'disturbance', type: 'textarea', wide: true }
      ]
    }
  ],
  actions: [
    { id: 'site-normal', label: '常规观察', collection: 'sites', patches: [{ field: 'protectedStatus', value: '常规观察' }] },
    { id: 'site-focus', label: '重点保护', collection: 'sites', patches: [{ field: 'protectedStatus', value: '重点保护' }] },
    { id: 'site-close', label: '暂停开放', collection: 'sites', danger: true, patches: [{ field: 'protectedStatus', value: '暂停开放' }] },
    {
      id: 'survey-alert',
      label: '标记异常',
      collection: 'surveys',
      relation: { collection: 'sites', localKey: 'siteId' },
      patches: [
        { field: 'status', value: '异常待复查' },
        { target: 'related', field: 'protectedStatus', value: '重点保护' }
      ]
    },
    {
      id: 'survey-review',
      label: '复查登记',
      collection: 'surveys',
      relation: { collection: 'sites', localKey: 'siteId' },
      visibleWhen: { field: 'status', values: ['异常待复查'] },
      submitLabel: '提交复查',
      form: [
        { label: '复查人', name: 'reviewer', required: true },
        { label: '复查温度(℃)', name: 'reviewTemp', type: 'number', step: 'any', required: true },
        { label: '复查湿度(%)', name: 'reviewHumidity', type: 'number', step: 'any', required: true },
        { label: '复查CO2(ppm)', name: 'reviewCo2', type: 'number', step: 'any', required: true },
        { label: '复查说明', name: 'reviewNote', type: 'textarea', wide: true }
      ],
      guards: [
        { left: 'related', op: 'missing', message: '关联样点不存在，无法登记复查' },
        { left: 'item.status', op: 'eq', right: '异常待复查', message: '仅异常待复查的巡测可登记复查，已复查记录不能重复登记' }
      ],
      patches: [
        { field: 'reviewer', valuePath: 'body.reviewer' },
        { field: 'reviewTemp', valuePath: 'body.reviewTemp' },
        { field: 'reviewHumidity', valuePath: 'body.reviewHumidity' },
        { field: 'reviewCo2', valuePath: 'body.reviewCo2' },
        { field: 'reviewNote', valuePath: 'body.reviewNote' }
      ],
      branches: [
        {
          when: [
            { left: 'body.reviewTemp', op: 'lte', rightPath: 'related.baselineTemp', margin: 0.5 },
            { left: 'body.reviewHumidity', op: 'gte', rightPath: 'related.baselineHumidity', margin: -2 },
            { left: 'body.reviewCo2', op: 'lte', rightPath: 'related.baselineCo2', margin: 50 }
          ],
          note: '复查达标，异常结案并恢复常规观察',
          patches: [
            { field: 'status', value: '已复查' },
            { field: 'reviewResult', value: '复查达标' },
            { target: 'related', field: 'protectedStatus', value: '常规观察' }
          ]
        },
        {
          note: '复查仍超标，保留重点保护',
          patches: [
            { field: 'reviewResult', value: '复查仍超标' }
          ]
        }
      ]
    }
  ]
};
