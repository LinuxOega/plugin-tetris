package run.halo.tetris;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.core.extension.content.SinglePage;
import run.halo.app.core.extension.content.Snapshot;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataUtil;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Ref;

/**
 * Creates the single {@code SinglePage} that exposes the game at the site's own
 * {@code /tetris} path (the browser supplies whatever domain is in use).
 *
 * <p>Halo only lets plugins own {@code /plugins/**} and {@code /apis/**}; a root
 * path must be backed by a content extension. So at plugin start we create both
 * the page and its content snapshot, fully published and public, so the theme
 * route {@code /{slug}} is registered immediately. The operation is idempotent:
 *
 * <ul>
 *   <li>If our own page already exists, its content is never overwritten; only
 *       missing publication metadata is repaired (self-healing after an admin
 *       accidentally unpublishes, deletes or renames it).</li>
 *   <li>If another page already owns the {@code tetris} slug, we do nothing
 *       and log a warning rather than creating a conflicting duplicate.</li>
 *   <li>Uninstalling the plugin does not delete the page, so any edits made by
 *       the site owner are preserved.</li>
 * </ul>
 *
 * <p>Halo 2.27 stores page content in a {@link Snapshot} extension. A base
 * snapshot must carry the {@code content.halo.run/keep-raw} annotation and hold
 * the full raw/rendered HTML in {@code rawPatch} / {@code contentPatch}; the
 * page's {@code baseSnapshot}, {@code headSnapshot} and {@code releaseSnapshot}
 * all point at it. The core reconciler then sets the permalink and public route.
 * No hostname is used anywhere: the iframe and every link are same-origin
 * relative paths, so the same JAR works on any domain.
 */
@Slf4j
@Component
public class TetrisPageInitializer {

    static final String PAGE_NAME = "plugin-tetris-page";
    static final String SNAPSHOT_NAME = "plugin-tetris-page-content";
    static final String SLUG = "tetris";
    static final String PAGE_TITLE = "俄罗斯方块";
    static final String OWNER = "plugin-tetris";
    static final String MANAGED_LABEL = "tetris.halo.run/managed";
    static final String RAW_TYPE_HTML = "HTML";

    private static final String FRAGMENT_RESOURCE = "page/tetris.html";

    private final ReactiveExtensionClient client;

    public TetrisPageInitializer(ReactiveExtensionClient client) {
        this.client = client;
    }

    /**
     * Ensure the game page exists and is reachable at {@code /tetris}.
     *
     * @return {@code true} when a page/snapshot was created or repaired,
     *         {@code false} when nothing needed doing (or the slug is taken)
     */
    public Mono<Boolean> ensurePage() {
        return client.fetch(SinglePage.class, PAGE_NAME)
            .flatMap(this::repairExisting)
            .switchIfEmpty(Mono.defer(this::createIfSlugFree));
    }

    /** Never overwrite content; only restore the publication contract. */
    private Mono<Boolean> repairExisting(SinglePage page) {
        if (!isManaged(page)) {
            log.info("A SinglePage named {} already exists but is not managed by this plugin; "
                    + "leaving it untouched", PAGE_NAME);
            return Mono.just(false);
        }
        return client.fetch(Snapshot.class, SNAPSHOT_NAME)
            .map(ignored -> true)
            .switchIfEmpty(Mono.defer(() -> {
                log.warn("Game page content snapshot is missing; recreating {}", SNAPSHOT_NAME);
                return client.create(buildSnapshot(pageContent())).map(ignored -> true);
            }))
            .flatMap(ignored -> {
                if (!applyPublishingContract(page)) {
                    log.info("Game page {} is already published at /{}", PAGE_NAME, SLUG);
                    return Mono.just(false);
                }
                log.info("Repairing publication state of game page {} for /{}", PAGE_NAME, SLUG);
                return client.update(page).thenReturn(true);
            });
    }

    /** Create only when no other live page owns the slug. */
    private Mono<Boolean> createIfSlugFree() {
        return client.listAll(SinglePage.class, ListOptions.builder().build(), Sort.unsorted())
            .filter(candidate -> candidate.getSpec() != null
                && SLUG.equals(candidate.getSpec().getSlug())
                && !Boolean.TRUE.equals(candidate.getSpec().getDeleted()))
            .hasElements()
            .flatMap(occupied -> {
                if (occupied) {
                    log.warn("Slug /{} is already used by another SinglePage; "
                            + "skipping automatic page creation to avoid a route conflict. "
                            + "Rename or delete that page and restart the plugin to let it take over.",
                        SLUG);
                    return Mono.just(false);
                }
                var content = pageContent();
                var snapshot = buildSnapshot(content);
                var page = buildPage();
                // Snapshot first: the core reconciler validates releaseSnapshot on publish.
                return client.create(snapshot)
                    .then(client.create(page))
                    .thenReturn(true)
                    .doOnSuccess(ignored -> log.info(
                        "Created published public SinglePage {} at /{}", PAGE_NAME, SLUG));
            });
    }

    private static boolean isManaged(SinglePage page) {
        var metadata = page.getMetadata();
        var labels = metadata == null ? null : metadata.getLabels();
        return labels != null && "true".equals(labels.get(MANAGED_LABEL));
    }

    /** Build a fully published, public page; safe to call on a freshly fetched object. */
    static SinglePage buildPage() {
        var page = new SinglePage();
        var metadata = new Metadata();
        metadata.setName(PAGE_NAME);
        metadata.setLabels(new HashMap<>());
        metadata.setAnnotations(new HashMap<>());
        page.setMetadata(metadata);

        var spec = new SinglePage.SinglePageSpec();
        spec.setTitle(PAGE_TITLE);
        spec.setSlug(SLUG);
        spec.setOwner(OWNER);
        spec.setBaseSnapshot(SNAPSHOT_NAME);
        spec.setHeadSnapshot(SNAPSHOT_NAME);
        spec.setReleaseSnapshot(SNAPSHOT_NAME);
        spec.setPublish(true);
        spec.setPublishTime(Instant.now());
        spec.setVisible(Post.VisibleEnum.PUBLIC);
        spec.setDeleted(false);
        spec.setPinned(false);
        spec.setAllowComment(false);
        spec.setPriority(0);
        var excerpt = new Post.Excerpt();
        excerpt.setAutoGenerate(false);
        excerpt.setRaw("");
        spec.setExcerpt(excerpt);
        spec.setHtmlMetas(List.of());
        page.setSpec(spec);

        applyPublishingContract(page);
        return page;
    }

    /**
     * Restore everything the theme's public finder and the core reconciler need.
     * Existing user content (title, snapshots with edits) is preserved: snapshot
     * pointers are only filled when blank, never changed.
     *
     * @return whether anything was changed
     */
    static boolean applyPublishingContract(SinglePage page) {
        var metadata = page.getMetadata();
        if (metadata == null) {
            metadata = new Metadata();
            metadata.setName(PAGE_NAME);
            page.setMetadata(metadata);
        }
        var spec = page.getSpec();
        boolean changed = false;
        if (spec == null) {
            spec = new SinglePage.SinglePageSpec();
            page.setSpec(spec);
            changed = true;
        }
        if (!SLUG.equals(spec.getSlug())) {
            spec.setSlug(SLUG);
            changed = true;
        }
        if (!Boolean.TRUE.equals(spec.getPublish())) {
            spec.setPublish(true);
            changed = true;
        }
        if (spec.getPublishTime() == null) {
            spec.setPublishTime(Instant.now());
            changed = true;
        }
        if (spec.getVisible() != Post.VisibleEnum.PUBLIC) {
            spec.setVisible(Post.VisibleEnum.PUBLIC);
            changed = true;
        }
        if (Boolean.TRUE.equals(spec.getDeleted())) {
            spec.setDeleted(false);
            changed = true;
        }
        if (spec.getOwner() == null || spec.getOwner().isBlank()) {
            spec.setOwner(OWNER);
            changed = true;
        }
        if (spec.getBaseSnapshot() == null || spec.getBaseSnapshot().isBlank()) {
            spec.setBaseSnapshot(SNAPSHOT_NAME);
            changed = true;
        }
        if (spec.getHeadSnapshot() == null || spec.getHeadSnapshot().isBlank()) {
            spec.setHeadSnapshot(spec.getBaseSnapshot());
            changed = true;
        }
        if (spec.getReleaseSnapshot() == null || spec.getReleaseSnapshot().isBlank()) {
            spec.setReleaseSnapshot(spec.getHeadSnapshot());
            changed = true;
        }

        var labels = MetadataUtil.nullSafeLabels(page);
        changed |= putIfDifferent(labels, SinglePage.PUBLISHED_LABEL, "true");
        changed |= putIfDifferent(labels, SinglePage.VISIBLE_LABEL, Post.VisibleEnum.PUBLIC.name());
        changed |= putIfDifferent(labels, SinglePage.DELETED_LABEL, "false");
        changed |= putIfDifferent(labels, SinglePage.OWNER_LABEL, spec.getOwner());
        changed |= putIfDifferent(labels, MANAGED_LABEL, "true");

        // Deliberately do NOT pre-write LAST_RELEASED_SNAPSHOT_ANNO: leaving it
        // absent lets the core reconciler run its normal publish pass (it then
        // fills the annotation, conditions, phase and permalink). The published
        // label above is already set, so the theme route works immediately.

        var status = page.getStatusOrDefault();
        if (!Post.PostPhase.PUBLISHED.name().equals(status.getPhase())) {
            status.setPhase(Post.PostPhase.PUBLISHED.name());
            changed = true;
        }
        return changed;
    }

    private static boolean putIfDifferent(
        java.util.Map<String, String> map, String key, String value) {
        if (value != null && value.equals(map.get(key))) {
            return false;
        }
        map.put(key, value);
        return true;
    }

    /** Base snapshot: full HTML content, not a diff (KEEP_RAW_ANNO). */
    static Snapshot buildSnapshot(String content) {
        var snapshot = new Snapshot();
        var metadata = new Metadata();
        metadata.setName(SNAPSHOT_NAME);
        var annotations = new HashMap<String, String>();
        annotations.put(Snapshot.KEEP_RAW_ANNO, Boolean.TRUE.toString());
        metadata.setAnnotations(annotations);
        snapshot.setMetadata(metadata);

        var spec = new Snapshot.SnapShotSpec();
        spec.setSubjectRef(Ref.of(PAGE_NAME, SinglePage.GVK));
        spec.setRawType(RAW_TYPE_HTML);
        spec.setRawPatch(content);
        spec.setContentPatch(content);
        spec.setOwner(OWNER);
        spec.setContributors(new LinkedHashSet<>(Set.of(OWNER)));
        spec.setLastModifyTime(Instant.now());
        snapshot.setSpec(spec);
        return snapshot;
    }

    private static String pageContent() {
        try (InputStream in = TetrisPageInitializer.class.getClassLoader()
            .getResourceAsStream(FRAGMENT_RESOURCE)) {
            if (in == null) {
                throw new IllegalStateException("Missing plugin resource: " + FRAGMENT_RESOURCE);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + FRAGMENT_RESOURCE, e);
        }
    }
}
