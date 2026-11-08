# DSH桌面版介入钉钉机器人
把钉钉机器人接入DeepSeek Harness（DSH）桌面版 主机锁屏时，在手机上给机器人发消息，DSH Agent 干活并在钉钉回复。 支持拉群及命令下发者白名单

插件版本： 1.1.261022 · 许可证： MIT 
适配版本：DSH 桌面版 44.7.0、@dingtalk-real-ai/dsh-dingtalk0.10.2 
项目：ESM JavaScript

## 一、效果示例
在 插件 选择安装的插件，启动
<img width="1046" height="886" alt="76DB9CCA-2463-45e8-9F26-C42203B90E34" src="https://github.com/user-attachments/assets/56f721ed-acf0-4111-b6db-1530650b63d8" />
插件需要在 左下角-更多-设置 配置，点击应用凭据，填写钉钉企业内部应用的 Client ID / Client Secret，测试连接，成功则点击保存并连接
<img width="786" height="469" alt="37AC4B1D-FDBF-4d07-85F8-2DF722B2C70D" src="https://github.com/user-attachments/assets/543dacfd-31e3-4fb7-ab95-1117d3c4a3a0" />
填写相关内容
<img width="582" height="527" alt="FECE5992-F202-4a6c-B055-3E68EFD186C3" src="https://github.com/user-attachments/assets/43dc254d-3213-4cc8-b789-81159530da2f" />
访问范围：管理员 staffId、私聊策略（所有人 / 仅管理员 / 管理员 + 白名单）、群聊策略（所有群 / 禁止 / 白名单群）、额外允许的 staffId、群 openConversationId 白名单。
重新连接 / 刷新状态
会话工作目录等：新建钉钉会话时 Agent 在主机的工作目录。
<img width="562" height="396" alt="140B6A5B-EC71-47b3-9021-0EA1CC3AC986" src="https://github.com/user-attachments/assets/150a4811-0f3e-4e08-8325-be490b421251" />

设置页永远拿不到 Client Secret：浏览器只拿到 hasSecret 标志和密钥尾号。

## 二、安装方式
方式 A：插件面板
下载 dsh-dingtalk-plugin-1.1.261022.tgz
DSH 桌面版 → 插件 → 添加插件，填入该tgz的绝对路径：<你的下载目录>\dsh-dingtalk-plugin-1.1.261022.tgz。
等安装完成，点立即启用
重启 DSH 桌面版
方式 B：从源码目录安装
在「添加插件」里选择 dsh-dingtalk-plugin

## 三、测试文件夹
用以检查测试文件是否全部安装，检测方法如下 进入主机deepseek harness插件目录（默认C:\Users\Administrator\Documents\deepseek-harness\default-workspace\） cd C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-dingtalk-plugin node --test test/host.test.mjs test/session-preset.test.mjs node test/client.harness.mjs

## 四、FAQ
### 4.1 是否涉及改内核？
不涉及。 插件不修改任何 DSH 安装文件，也不改官方连接器的源码或 Config schema。它是一个普通的 DSH 插件： 
1.cordis.patch.yml（bundle patch）插入两行：带默认预设的官方连接器行，以及本插件的 Host 行。 
2.Host 半注册 /.dsh-dingtalk/* 路由；Client 半在应用设置里注册一个 settings.section 页面。 
3.配置改动由 DSH 自身持久化到 profile 的 cordis.patch.yml（clientId、clientSecret、访问策略、工作目录）和 %USERPROFILE%.dsh-dingtalk\。新会话的「Agent 预设」会写成 DSH 默认 Agent 预设（agent-preset-registry.selectedDefault）。
对系统的影响只有 DSH 自身的 profile / 配置写入。

### 4.2 构建步骤
没有构建步骤。 本包是纯 ESM JavaScript：没有 TypeScript、没有打包器、没有原生模块、没有编译器。安装完即可用，没有 build / prepack 脚本。发布用的 tgz 就是对目录做一次普通 tar（见「七、开发与打包」）。测试是可选的，只需要 Node。

### 4.3 特定依赖
@dingtalk-real-ai/dsh-dingtalk ^0.10.2：自动安装，提供钉钉通道运行时。
@deepseek-ai/cordis ^4.0.1：peer 依赖，可选，由 DSH Host 提供。
Node ^22.19.0 || >=24.0.0：由 DSH 桌面版自带，终端用户无需安装。
不需要额外的 Windows 组件、系统服务、证书或驱动。

### 4.4 重启时机
安装或升级插件后：重启 DSH 桌面版（Host 插件只在启动时加载）。
修改连接配置：不需要重启（连接器行会就地重载）。
从更早的 v1.1 构建升级：重启一次，清掉旧的工具重复注册（见「八、版本说明」）。

### 4.5 行为上的注意点
新会话预设里选的 Agent 预设会写成 DSH 新会话默认 Agent 预设，对所有新会话（含桌面端）生效，不局限于钉钉。关闭该功能后会恢复部署默认。
6 项自我介绍需要先勾选「新会话预设」或「注入 Agent 性格 md」；单独开启不会生效。
模型与推理等级按当前运行时的选项目录解析：不可用的值会保留在表单里但不会生效，自我介绍始终报告实际生效值。
会话一旦开始，Agent 预设不能切换；需要换预设时在钉钉里发 /new 重开。
插件用到少量非长期稳定公开契约的 Host 接口（configEditor.edit、webServer.register、sessionController.selectForNextRequest、permissionPresets.apply、connection.requestRejection）。某个接口在某个 DSH 版本缺失时，对应功能会跳过并写日志，不会让 Agent 创建失败；升级 DSH 后建议重新验证。

### 4.6 安全须知
钉钉消息会以你的 Windows 用户身份在本机执行：Agent 可以读写文件、运行命令。默认预设是「所有人可私聊 + 所有群可用」，方便先跑通；机器或机器人不是自己独占时，跑通后请立刻收紧（填管理员 staffId、私聊改「仅管理员」、群聊改「禁止群聊」）。
Client Secret 以明文存进本机的 profile patch（这是 DSH 自己的配置权限模型），不会发给浏览器页面，也不会写入本插件的状态文件。
本插件的 HTTP 路由只监听本机回环地址，且只接受同源 JSON 请求；能改你 profile 文件的程序也能改这些配置，所以请保护你的 Windows 账户。
插件自身只访问 api.dingtalk.com（凭据探测）；钉钉长连接由官方连接器维护。本插件不上报任何遥测。

## 五、 卸载
在插件面板移除本插件；或删掉 %USERPROFILE%.dsh\profiles\desktop\package.json 里对应的依赖与 bundle 条目，在该目录执行 pnpm install，再重启。profile patch 里的凭据和 %USERPROFILE%.dsh-dingtalk\ 下的状态文件可手工删除。
