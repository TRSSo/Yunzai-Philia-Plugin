const logger = Object.create(global.logger)
for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"])
  logger[i] = (...args) => Bot.makeLog(i, args, "Philia")
logger.info(logger.yellow("- 正在加载 Philia 适配器插件"))

import Path from "node:path"
import * as Connect from "philia/connect"
import pkg from "philia/package.json" with { type: "json" }
import { Project } from "philia/project/project/philia.js"
import oicq from "philia/protocol/oicq"
import { getProjectDir } from "philia/util"
import { ulid } from "ulid"
import cfg from "../../lib/config/config.js"
import makeConfig from "../../lib/plugins/config.js"

const { config, configSave } = await makeConfig(
  "Philia",
  {
    tips: "",
    permission: "master",
    bot: {},
    connect: [],
  },
  {
    tips: [
      "欢迎使用 TRSS-Yunzai Philia Plugin ! 作者：时雨🌌星空",
      "参考：https://github.com/TRSSo/Yunzai-Philia-Plugin",
    ],
  },
)

const adapter = new (class PhiliaAdapter {
  constructor() {
    this.id = "Philia"
    this.name = "Philia"
    this.version = `v${pkg.version}`
  }

  async login(client, send = Bot.sendMasterMsg.bind(Bot), is_server) {
    const { id } = await client.request("getSelfInfo")
    const logger = {}
    for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"])
      logger[i] = (...args) => Bot.makeLog(i, args, id)
    client.logger = logger

    const bot = oicq.createClient(client, {
      cache_group_member: cfg.bot.cache_group_member,
      ...config.bot,
      ...config.bot[id],
      logger,
    })
    Object.defineProperty(bot, "version", { get: () => bot.version_info.impl })

    await bot.login()
    Bot[id] = bot

    bot.on("system.offline", data => {
      Bot.em("system.offline", data)
      send(`[${id}] ${data.message}`)
      if (is_server)
        Bot.uin.some((i, index) => {
          if (Bot[i].client === client) {
            Bot.uin.splice(index, 1)
            delete Bot[i]
            return true
          }
          return false
        })
    })

    bot.on("message", data =>
      Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data),
    )
    bot.on("notice", data => Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data))
    bot.on("request", data =>
      Bot.em(`${data.post_type}.${data.request_type}.${data.sub_type}`, data),
    )

    logger.mark(`${bot.version?.name}(${bot.version?.id}) ${bot.version?.version} 已连接`)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async connect(config, send) {
    if (config.role === "Client") {
      let path = config.path
      if (path.startsWith("file://")) path = path.slice(7)
      else if (!path.startsWith("tcp://")) path = getProjectDir(path, config.name || "Philia")

      const client = new Connect[config.type].Client(logger, this.handles, config.opts)
      await client.connect(path)
      return this.login(client, send)
    } else {
      this.server = new Connect[config.type].Server(logger, this.handles, {
        ...config.opts,
        connected_fn: client => this.login(client, send, true),
      })
      await this.server.listen(config.path ?? Path.resolve(config.name || "Philia"))
    }
  }

  async load() {
    for (const connect of config.connect)
      await Bot.sleep(
        5000,
        this.connect(connect).catch(error => logger.error({ ...connect, error })),
      )
  }
})()

Bot.adapter.push(adapter)

export class PhiliaAdapter extends plugin {
  constructor() {
    super({
      name: "PhiliaAdapter",
      dsc: "Philia 适配器设置",
      event: "message",
      rule: [
        {
          reg: "^#(P|p)(hilia)?连接$",
          fnc: "List",
          permission: config.permission,
        },
        {
          reg: "^#(P|p)(hilia)?删除\\d+$",
          fnc: "Del",
          permission: config.permission,
        },
        {
          reg: "^#(P|p)(hilia)?设置$",
          fnc: "Set",
          permission: config.permission,
        },
      ],
    })
  }

  List() {
    return this.reply(
      `共${config.connect.length}个连接：\n${config.connect.map((i, id) => `${id + 1}. ${i.type} ${i.role} ${i.path ?? Path.resolve("Philia")}`).join("\n")}`,
      true,
    )
  }

  async Del() {
    const id = Number(this.e.msg.replace(/^#(P|p)(hilia)?删除/, "")) - 1
    if (!config.connect[id]) return this.reply("未找到该地址")
    config.connect.splice(id, 1)
    await configSave()
    return this.reply("删除成功，重启后生效", true)
  }

  async Set() {
    const get = async () =>
      (await this.awaitContext()).message
        .reduce((a, b) => (b.type === "text" ? a + b.text : a), "")
        .trim()
    const connect = { opts: { meta: { id: ulid() } } }

    await this.reply("请选择 Philia 协议类型\n1. Socket\n2. WebSocket")
    let choose = await get()
    switch (choose) {
      case "1":
      case "Socket":
        connect.type = "Socket"
        break
      case "2":
      case "WebSocket":
        connect.type = "WebSocket"
        break
      default:
        return this.reply("请选择正确的选项")
    }

    await this.reply("请选择 Philia 协议端类型\n1. 服务端\n2. 客户端")
    choose = await get()
    switch (choose) {
      case "1":
      case "Server":
      case "服务端":
        connect.role = "Server"
        break
      case "2":
      case "Client":
      case "客户端":
        connect.role = "Client"
        break
      default:
        return this.reply("请选择正确的选项")
    }

    switch (connect.type) {
      case "Socket":
        if (connect.role === "Server") {
          await this.reply(`Philia Socket 服务器监听在 ${Path.resolve("Philia")}`)
        } else {
          const list = await Project.getClientProject("Impl")
          let msg = "请选择 Philia Socket 服务器地址\n0. 自定义"
          for (const i in list) msg += `\n${Number(i) + 1}. ${list[i][1]}`
          await this.reply(msg)
          const choose = await get()
          if (choose === "0") {
            await this.reply("请输入 Philia Socket 服务器地址")
            connect.path = await get()
            if (connect.path && !connect.path.startsWith("tcp://"))
              connect.path = `file://${connect.path}`
          } else {
            connect.path = list[Number(choose) - 1][0]
          }
          if (!connect.path) return this.reply("请输入正确的地址")
        }
        break
      case "WebSocket":
        if (connect.role === "Server") {
          await this.reply("请输入 Philia WebSocket 服务器监听端口")
          connect.path = await get()
        } else {
          await this.reply("请输入 Philia WebSocket 服务器地址")
          connect.path = await get()
        }
        break
    }
    if (
      config.connect.some(
        i => i.type === connect.type && i.role === connect.role && i.path === connect.path,
      )
    )
      return this.reply("已存在相同连接")
    try {
      await this.reply("正在连接中...")
      await adapter.connect(connect, this.reply.bind(this))
    } catch (err) {
      logger.error(err)
      return this.reply(`错误：${err.message}`)
    }
    config.connect.push(connect)
    await configSave()
  }
}

logger.info(logger.green("- Philia 适配器插件 加载完成"))
