package com.jefflower.fdserver.task.service;

import com.jefflower.fdserver.task.entity.TaskInstance;

public interface TaskHandler {
    String execute(TaskInstance taskInstance) throws Exception;
}
