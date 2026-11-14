package run.halo.tetris;

import java.time.Duration;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpecs;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * Plugin entry point. On start it registers the TetrisScore scheme (and the score
 * index used by the leaderboard query) and idempotently creates the public
 * SinglePage that serves the game at /tetris. On stop it unregisters the
 * custom scheme; the generated page is intentionally left in place so that
 * admin edits and leaderboard data are never destroyed by an update/uninstall.
 */
@Slf4j
@Component
public class TetrisPlugin extends BasePlugin {

    private final SchemeManager schemeManager;
    private final TetrisPageInitializer pageInitializer;

    public TetrisPlugin(PluginContext pluginContext, SchemeManager schemeManager,
        TetrisPageInitializer pageInitializer) {
        super(pluginContext);
        this.schemeManager = schemeManager;
        this.pageInitializer = pageInitializer;
    }

    @Override
    public void start() {
        schemeManager.register(TetrisScore.class, indexSpecs -> indexSpecs.add(
            IndexSpecs.<TetrisScore, Integer>single("spec.score", Integer.class)
                .indexFunc(score -> score.getSpec() == null ? null : score.getSpec().getScore())
        ));

        // Async + retry: during startup the extension store / core schemes may
        // not be ready for a few seconds. A page-creation failure must never
        // prevent the plugin (and its leaderboard API) from starting.
        pageInitializer.ensurePage()
            .retryWhen(Retry.backoff(3, Duration.ofSeconds(2))
                .maxBackoff(Duration.ofSeconds(8)))
            .onErrorResume(error -> {
                log.warn("Could not ensure the /tetris page; the game is still reachable at "
                        + "/plugins/plugin-tetris/assets/tetris/index.html. Cause: {}",
                    error.toString());
                return Mono.empty();
            })
            .subscribe();
    }

    @Override
    public void stop() {
        schemeManager.unregister(Scheme.buildFromType(TetrisScore.class));
    }
}
