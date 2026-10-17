-- find-skills 与 Code Mate 的 code-mate-* 技能改为默认关闭；用户仍可在技能设置中开启。
UPDATE `agent_global_skill`
SET `is_enabled` = 0
WHERE `folder_name` = 'find-skills';
--> statement-breakpoint
UPDATE `agent_global_skill`
SET `is_enabled` = 0
WHERE `folder_name` LIKE 'code-mate-%';
