package run.halo.tetris;

import static org.springframework.http.MediaType.APPLICATION_JSON;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.server.ServerWebInputException;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;

/**
 * Public leaderboard API:
 *   GET  /apis/api.tetris.halo.run/v1alpha1/scores?size=10
 *   POST /apis/api.tetris.halo.run/v1alpha1/scores
 *
 * The anonymous role template grants only get/list/create on this group.
 * A simple per-IP sliding window prevents trivial score flooding; the
 * underlying TetrisScore extension is never writable from the public API.
 */
@Component
@RequiredArgsConstructor
public class ScoreEndpoint implements CustomEndpoint {

    private static final long WINDOW_MILLIS = 60_000L;
    private static final int MAX_SUBMITS_PER_WINDOW = 10;
    private static final int DEFAULT_PAGE_SIZE = 10;

    private final ScoreService scoreService;
    private final Map<String, Deque<Long>> submissionWindows = new ConcurrentHashMap<>();

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET("/scores", this::list)
            .POST("/scores", this::submit)
            .build();
    }

    @Override
    public GroupVersion groupVersion() {
        return new GroupVersion("api.tetris.halo.run", "v1alpha1");
    }

    private Mono<ServerResponse> list(ServerRequest request) {
        var size = request.queryParam("size")
            .map(ScoreEndpoint::parseSize)
            .orElse(DEFAULT_PAGE_SIZE);
        return scoreService.leaderboard(size)
            .flatMap(items -> ServerResponse.ok().contentType(APPLICATION_JSON).bodyValue(items));
    }

    private Mono<ServerResponse> submit(ServerRequest request) {
        if (!allowed(clientIp(request))) {
            return ServerResponse.status(HttpStatus.TOO_MANY_REQUESTS)
                .contentType(APPLICATION_JSON)
                .bodyValue(Map.of("message", "Too many submissions, please try again later."));
        }
        return request.bodyToMono(ScoreSubmit.class)
            .switchIfEmpty(Mono.error(new ServerWebInputException("request body is required")))
            .flatMap(scoreService::submit)
            .flatMap(view -> ServerResponse.status(HttpStatus.CREATED)
                .contentType(APPLICATION_JSON)
                .bodyValue(view))
            .onErrorResume(ServerWebInputException.class, error ->
                ServerResponse.badRequest()
                    .contentType(APPLICATION_JSON)
                    .bodyValue(Map.of("message", reason(error))));
    }

    private static int parseSize(String raw) {
        try {
            return Math.min(Math.max(Integer.parseInt(raw), 1), ScoreService.MAX_PAGE_SIZE);
        } catch (NumberFormatException ignored) {
            return DEFAULT_PAGE_SIZE;
        }
    }

    private static String reason(ServerWebInputException error) {
        var reason = error.getReason();
        return reason == null || reason.isBlank() ? "Invalid request body" : reason;
    }

    private static String clientIp(ServerRequest request) {
        return request.remoteAddress()
            .map(address -> address.getAddress() == null
                ? "unknown" : address.getAddress().getHostAddress())
            .orElse("unknown");
    }

    private boolean allowed(String ip) {
        long now = System.currentTimeMillis();
        var window = submissionWindows.computeIfAbsent(ip, key -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MILLIS) {
                window.pollFirst();
            }
            if (window.size() >= MAX_SUBMITS_PER_WINDOW) {
                return false;
            }
            window.addLast(now);
        }
        // Bound memory growth for long-running instances with many distinct clients.
        if (submissionWindows.size() > 5_000) {
            submissionWindows.clear();
        }
        return true;
    }
}
