function replayUploadKey(event = {}) {
  const identity =
    event.filePath ||
    event.fileName;

  if (!identity) {
    return null;
  }

  return `${identity}:${event.isFinal ? "final" : "live"}`;
}

function createNetworkPriorityArbiter() {
  const activeReplayUploads =
    new Set();

  const streamControllers =
    new Set();

  let videoPreemptions = 0;

  function abortActiveVideoUploads() {
    let aborted = 0;

    for (const controller of streamControllers) {
      try {
        controller.abort(
          "replay_upload_priority"
        );
        aborted += 1;
      } catch {}
    }

    streamControllers.clear();
    videoPreemptions += aborted;

    return aborted;
  }

  function handleReplayEvent(event = {}) {
    if (
      event.type ===
      "watching-stopped"
    ) {
      activeReplayUploads.clear();

      return {
        replayPriorityActive:
          false,
        preemptedVideoUploads: 0,
      };
    }

    const key =
      replayUploadKey(event);

    if (!key) {
      return {
        replayPriorityActive:
          activeReplayUploads.size > 0,
        preemptedVideoUploads: 0,
      };
    }

    if (
      event.type ===
      "upload-start"
    ) {
      activeReplayUploads.add(key);

      return {
        replayPriorityActive:
          true,
        preemptedVideoUploads:
          abortActiveVideoUploads(),
      };
    }

    if (
      event.type ===
        "upload-success" ||
      event.type ===
        "upload-failure" ||
      event.type ===
        "upload-retry"
    ) {
      activeReplayUploads.delete(key);
    }

    return {
      replayPriorityActive:
        activeReplayUploads.size > 0,
      preemptedVideoUploads: 0,
    };
  }

  function registerStreamUpload(
    controller
  ) {
    if (
      !controller ||
      typeof controller.abort !==
        "function"
    ) {
      return false;
    }

    if (
      activeReplayUploads.size > 0
    ) {
      try {
        controller.abort(
          "replay_upload_priority"
        );
      } catch {}

      return false;
    }

    streamControllers.add(
      controller
    );

    return true;
  }

  function unregisterStreamUpload(
    controller
  ) {
    streamControllers.delete(
      controller
    );
  }

  function isReplayPriorityActive() {
    return (
      activeReplayUploads.size > 0
    );
  }

  function snapshot() {
    return {
      replayPriorityActive:
        activeReplayUploads.size > 0,
      activeReplayUploads:
        activeReplayUploads.size,
      activeVideoUploads:
        streamControllers.size,
      videoPreemptions,
    };
  }

  return {
    handleReplayEvent,
    isReplayPriorityActive,
    registerStreamUpload,
    snapshot,
    unregisterStreamUpload,
  };
}

module.exports = {
  createNetworkPriorityArbiter,
  replayUploadKey,
};
