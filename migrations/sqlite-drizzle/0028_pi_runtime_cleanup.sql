-- 内网版删除了 Claude Code 运行时：旧智能体统一迁到 Pi，并清掉只有 Claude 运行时消费的旧配置。
-- 旧会话的 resume token 是 Claude 的 session id，Pi 无法恢复，先清空让 Pi 从新会话开始。
UPDATE `agent_session_message`
SET `runtime_resume_token` = NULL
WHERE `runtime_resume_token` IS NOT NULL
  AND `session_id` IN (
    SELECT `s`.`id`
    FROM `agent_session` AS `s`
    INNER JOIN `agent` AS `a` ON `a`.`id` = `s`.`agent_id`
    WHERE `a`.`type` IN ('claude-code', 'cherry-claw')
  );
--> statement-breakpoint
-- 切到 Pi；Pi 不支持 plan 权限模式，回落到 Pi 的创建默认 auto。
-- env_vars 与 plan/small 模型档位只有 Claude 运行时会读取，一并清除。
UPDATE `agent`
SET
  `type` = 'pi',
  `plan_model` = NULL,
  `small_model` = NULL,
  `configuration` = CASE
    WHEN json_valid(`configuration`) THEN
      json_remove(
        CASE
          WHEN json_extract(`configuration`, '$.permission_mode') = 'plan'
          THEN json_set(`configuration`, '$.permission_mode', 'auto')
          ELSE `configuration`
        END,
        '$.env_vars'
      )
    ELSE `configuration`
  END
WHERE `type` IN ('claude-code', 'cherry-claw');
