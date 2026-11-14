package run.halo.tetris;

import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ServerWebInputException;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.PageRequestImpl;
import run.halo.app.extension.ReactiveExtensionClient;

/** Leaderboard persistence built on Halo's custom model (Extension) store. */
@Service
@RequiredArgsConstructor
public class ScoreService {

    static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_SCORE = 10_000_000;
    private static final int MAX_PLAYER_LENGTH = 24;

    private final ReactiveExtensionClient client;

    /** Top scores, ordered by spec.score (registered as an index at plugin start). */
    public Mono<List<ScoreView>> leaderboard(int size) {
        int limit = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        var sort = Sort.by(Sort.Order.desc("spec.score"));
        var pageable = PageRequestImpl.of(1, limit, sort);
        return client.listBy(TetrisScore.class, ListOptions.builder().build(), pageable)
            .map(result -> result.getItems().stream().map(ScoreService::toView).toList());
    }

    /** Validate and persist one score. Only normalized, bounded values reach storage. */
    public Mono<ScoreView> submit(ScoreSubmit body) {
        if (body == null) {
            throw new ServerWebInputException("request body is required");
        }
        var player = sanitize(body.player());
        if (player.isEmpty() || player.length() > MAX_PLAYER_LENGTH) {
            throw new ServerWebInputException("player must contain 1 to 24 visible characters");
        }
        var score = body.score();
        if (score == null || score < 0 || score > MAX_SCORE) {
            throw new ServerWebInputException("score must be between 0 and " + MAX_SCORE);
        }

        var spec = new TetrisScore.Spec();
        spec.setPlayer(player);
        spec.setScore(score);
        spec.setLines(clamp(body.lines(), 0, 1_000_000, 0));
        spec.setLevel(clamp(body.level(), 1, 20, 1));
        spec.setPieces(clamp(body.pieces(), 0, 1_000_000, 0));

        var extension = new TetrisScore();
        var metadata = new Metadata();
        metadata.setName("score-" + UUID.randomUUID());
        extension.setMetadata(metadata);
        extension.setSpec(spec);

        return client.create(extension).map(ScoreService::toView);
    }

    /** Remove control characters and collapse whitespace so the name is safe to render as text. */
    private static String sanitize(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replaceAll("[\\p{Cntrl}]", "").trim().replaceAll("\\s+", " ");
    }

    private static int clamp(Integer value, int min, int max, int fallback) {
        if (value == null) {
            return fallback;
        }
        return Math.min(Math.max(value, min), max);
    }

    private static ScoreView toView(TetrisScore extension) {
        var spec = extension.getSpec();
        var metadata = extension.getMetadata();
        var timestamp = metadata == null ? null : metadata.getCreationTimestamp();
        return new ScoreView(
            spec == null || spec.getPlayer() == null ? "" : spec.getPlayer(),
            spec == null || spec.getScore() == null ? 0 : spec.getScore(),
            spec == null || spec.getLines() == null ? 0 : spec.getLines(),
            spec == null || spec.getLevel() == null ? 1 : spec.getLevel(),
            spec == null || spec.getPieces() == null ? 0 : spec.getPieces(),
            timestamp == null ? null : timestamp.toString()
        );
    }
}
