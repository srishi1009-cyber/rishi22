// ============================================================
// RISHI MUSIC - COMPLETE APP ENGINE
// RISHI21 PWA VERSION
// ============================================================

const DB_NAME = "RishiMusicDB";
const DB_VERSION = 3;
const STORE_NAME = "tracks";

// ============================================================
// APP STATE
// ============================================================

let db = null;
let songs = [];
let currentIndex = -1;

let activeArtist = "all";
let searchQuery = "";

let isTransitioning = false;
let playbackGeneration = 0;
let activePlayPromise = null;

// Unique shuffle/cycle pool
let unplayedQueue = [];

// Persistent Blob URL cache
const blobUrlCache = new WeakMap();

// ============================================================
// AUDIO ENGINE
// ============================================================

const audio =
    document.getElementById("audioEngine") ||
    new Audio();

audio.id = "audioEngine";
audio.preload = "auto";
audio.setAttribute("playsinline", "true");

if (!document.getElementById("audioEngine")) {
    document.body.appendChild(audio);
}

// ============================================================
// DAILY NO-REPEAT ENGINE
// ============================================================

function getTodayKey() {
    const now = new Date();

    return `rishi_played_${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}`;
}

function getDailyPlayedIds() {
    try {
        const data = localStorage.getItem(getTodayKey());

        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.warn("Could not read daily history:", error);
        return [];
    }
}

function markSongPlayedToday(songId) {
    if (songId === undefined || songId === null) {
        return;
    }

    try {
        const key = getTodayKey();

        let played = getDailyPlayedIds();

        if (!played.includes(songId)) {
            played.push(songId);

            localStorage.setItem(
                key,
                JSON.stringify(played)
            );
        }
    } catch (error) {
        console.warn("Could not save daily history:", error);
    }
}

// ============================================================
// INDEXED DB
// ============================================================

function openDatabase() {
    return new Promise((resolve, reject) => {

        if (!window.indexedDB) {
            reject(
                new Error("IndexedDB is not supported in this browser.")
            );
            return;
        }

        const request = indexedDB.open(
            DB_NAME,
            DB_VERSION
        );

        request.onupgradeneeded = (event) => {

            const database = event.target.result;

            if (
                !database.objectStoreNames.contains(
                    STORE_NAME
                )
            ) {
                database.createObjectStore(
                    STORE_NAME,
                    {
                        keyPath: "id",
                        autoIncrement: true
                    }
                );
            }
        };

        request.onsuccess = () => {

            db = request.result;

            db.onversionchange = () => {
                db.close();
            };

            resolve(db);
        };

        request.onerror = () => {
            reject(request.error);
        };

        request.onblocked = () => {
            console.warn(
                "IndexedDB upgrade is blocked."
            );
        };
    });
}

function saveTrackToDB(track) {
    return new Promise((resolve, reject) => {

        if (!db) {
            reject(
                new Error("Database is not ready.")
            );
            return;
        }

        const transaction =
            db.transaction(
                STORE_NAME,
                "readwrite"
            );

        const store =
            transaction.objectStore(
                STORE_NAME
            );

        const request = store.add(track);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function loadAllTracksFromDB() {
    return new Promise((resolve, reject) => {

        if (!db) {
            reject(
                new Error("Database is not ready.")
            );
            return;
        }

        const transaction =
            db.transaction(
                STORE_NAME,
                "readonly"
            );

        const store =
            transaction.objectStore(
                STORE_NAME
            );

        const request = store.getAll();

        request.onsuccess = () => {

            resolve(
                Array.isArray(request.result)
                    ? request.result
                    : []
            );
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function updateTrackInDB(track) {
    return new Promise((resolve, reject) => {

        if (!db) {
            reject(
                new Error("Database is not ready.")
            );
            return;
        }

        const transaction =
            db.transaction(
                STORE_NAME,
                "readwrite"
            );

        const store =
            transaction.objectStore(
                STORE_NAME
            );

        const request = store.put(track);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// ============================================================
// SONG HELPERS
// ============================================================

function getSongTitle(song) {

    if (!song) {
        return "Unknown Song";
    }

    return (
        song.title ||
        song.name ||
        "Unknown Song"
    );
}

function getSongArtist(song) {

    if (!song) {
        return "UNKNOWN DIRECTOR";
    }

    return String(
        song.artist ||
        song.director ||
        "Unknown Director"
    )
        .trim()
        .toUpperCase();
}

function getSongSource(song) {

    if (!song) {
        return null;
    }

    // Local imported song
    if (song.blob) {

        try {

            if (!blobUrlCache.has(song.blob)) {

                const objectUrl =
                    URL.createObjectURL(
                        song.blob
                    );

                blobUrlCache.set(
                    song.blob,
                    objectUrl
                );
            }

            return blobUrlCache.get(
                song.blob
            );

        } catch (error) {

            console.error(
                "Could not create Blob URL:",
                error
            );

            return null;
        }
    }

    // Remote song
    if (song.url) {
        return song.url;
    }

    return null;
}

// ============================================================
// FILTERING
// ============================================================

function getFilteredSongIndexes() {

    const result = [];

    const query =
        searchQuery
            .trim()
            .toLowerCase();

    for (
        let i = 0;
        i < songs.length;
        i++
    ) {

        const song = songs[i];

        if (!song) {
            continue;
        }

        // Director filter
        if (
            activeArtist !== "all" &&
            getSongArtist(song).toLowerCase() !==
                activeArtist.toLowerCase()
        ) {
            continue;
        }

        // Search filter
        if (query) {

            const searchable = [
                getSongTitle(song),
                getSongArtist(song),
                song.name || "",
                song.director || ""
            ]
                .join(" ")
                .toLowerCase();

            if (!searchable.includes(query)) {
                continue;
            }
        }

        result.push(i);
    }

    return result;
}

// ============================================================
// AUTOMATIC PLAYBACK POOL
// ============================================================

function getAutomaticSongIndexes() {

    const result = [];

    for (
        let i = 0;
        i < songs.length;
        i++
    ) {

        const song = songs[i];

        if (!song) {
            continue;
        }

        if (
            activeArtist !== "all" &&
            getSongArtist(song).toLowerCase() !==
                activeArtist.toLowerCase()
        ) {
            continue;
        }

        result.push(i);
    }

    return result;
}

// ============================================================
// SMART NEXT SONG
// ============================================================

function getNextSmartSongIndex() {

    const pool =
        getAutomaticSongIndexes();

    if (pool.length === 0) {
        return -1;
    }

    if (pool.length === 1) {
        return pool[0];
    }

    const todayPlayed =
        getDailyPlayedIds();

    // Songs not played today
    let candidateIndexes =
        pool.filter(
            (idx) =>
                !todayPlayed.includes(
                    songs[idx]?.id
                )
        );

    // If all songs have already played today,
    // begin another cycle.
    if (candidateIndexes.length === 0) {
        candidateIndexes = pool.slice();
    }

    // Remove invalid queue entries
    unplayedQueue =
        unplayedQueue.filter(
            (idx) =>
                candidateIndexes.includes(idx)
        );

    // Create a fresh shuffled queue
    if (unplayedQueue.length === 0) {

        unplayedQueue =
            candidateIndexes.filter(
                (idx) =>
                    idx !== currentIndex
            );

        if (unplayedQueue.length === 0) {
            unplayedQueue =
                candidateIndexes.slice();
        }

        // Fisher-Yates shuffle
        for (
            let i =
                unplayedQueue.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() *
                        (i + 1)
                );

            [
                unplayedQueue[i],
                unplayedQueue[j]
            ] = [
                unplayedQueue[j],
                unplayedQueue[i]
            ];
        }
    }

    // In ALL mode try to change director
    if (
        activeArtist === "all" &&
        unplayedQueue.length > 1
    ) {

        const currentDirector =
            songs[currentIndex]
                ? getSongArtist(
                      songs[currentIndex]
                  )
                : null;

        const differentDirectorIndex =
            unplayedQueue.findIndex(
                (idx) =>
                    getSongArtist(
                        songs[idx]
                    ) !== currentDirector
            );

        if (
            differentDirectorIndex !== -1
        ) {

            return unplayedQueue.splice(
                differentDirectorIndex,
                1
            )[0];
        }
    }

    return unplayedQueue.shift();
}

// ============================================================
// TIME FORMAT
// ============================================================

function formatTime(seconds) {

    if (
        !Number.isFinite(seconds) ||
        seconds < 0
    ) {
        return "0:00";
    }

    const minutes =
        Math.floor(seconds / 60);

    const remaining =
        Math.floor(seconds % 60);

    return `${minutes}:${String(
        remaining
    ).padStart(2, "0")}`;
}

// ============================================================
// PLAYER INFORMATION
// ============================================================

function updatePlayerInformation(song) {

    const title =
        document.getElementById(
            "playerTitle"
        );

    const artist =
        document.getElementById(
            "playerArtist"
        );

    if (!song) {

        if (title) {
            title.textContent =
                "No track playing";
        }

        if (artist) {
            artist.textContent =
                "Select a song from your library";
        }

        return;
    }

    if (title) {
        title.textContent =
            getSongTitle(song);
    }

    if (artist) {
        artist.textContent =
            getSongArtist(song);
    }
}

function updatePlayButton() {

    const button =
        document.getElementById(
            "playBtn"
        );

    if (!button) {
        return;
    }

    button.textContent =
        audio.paused
            ? "▶"
            : "❚❚";
}

// ============================================================
// PLAYBACK ENGINE
// ============================================================

async function playSongAtIndex(
    index,
    isAuto = false
) {

    if (
        index < 0 ||
        index >= songs.length
    ) {
        return false;
    }

    const song = songs[index];

    if (!song) {
        return false;
    }

    const source =
        getSongSource(song);

    if (!source) {

        console.warn(
            "Unplayable track source:",
            song
        );

        if (isAuto) {
            return false;
        }

        return false;
    }

    // New playback generation
    const currentGen =
        ++playbackGeneration;

    // Wait for previous play request
    if (activePlayPromise) {

        try {
            await activePlayPromise;
        } catch (error) {
            // Expected if previous play was interrupted
        }
    }

    // Make sure another song wasn't
    // requested while waiting
    if (
        currentGen !==
        playbackGeneration
    ) {
        return false;
    }

    // Reset decoder completely
    try {

        audio.pause();

        audio.removeAttribute(
            "src"
        );

        audio.load();

    } catch (error) {

        console.warn(
            "Audio reset warning:",
            error
        );
    }

    currentIndex = index;

    try {

        audio.src = source;

        audio.currentTime = 0;

    } catch (error) {

        console.error(
            "Could not set audio source:",
            error
        );

        return false;
    }

    updatePlayerInformation(song);

    renderSongList();

    try {

        activePlayPromise =
            audio.play();

        await activePlayPromise;

        activePlayPromise = null;

        if (
            currentGen !==
            playbackGeneration
        ) {
            return false;
        }

        // Only mark as played once
        // playback actually starts.
        markSongPlayedToday(
            song.id
        );

        updatePlayButton();

        updateMediaSession(song);

        return true;

    } catch (error) {

        activePlayPromise = null;

        console.warn(
            "Playback error:",
            error
        );

        if (
            currentGen ===
            playbackGeneration
        ) {

            updatePlayButton();

            // Automatically try another song
            if (isAuto) {
                return false;
            }
        }

        return false;
    }
}

// ============================================================
// AUTOMATIC NEXT SONG
// ============================================================

async function playNextAutomaticSong() {

    if (isTransitioning) {
        return;
    }

    isTransitioning = true;

    try {

        const pool =
            getAutomaticSongIndexes();

        if (pool.length === 0) {
            return;
        }

        let attempts = 0;

        const maxAttempts =
            Math.min(
                pool.length,
                10
            );

        while (
            attempts <
            maxAttempts
        ) {

            attempts++;

            const nextIndex =
                getNextSmartSongIndex();

            if (nextIndex === -1) {
                break;
            }

            const success =
                await playSongAtIndex(
                    nextIndex,
                    true
                );

            if (success) {
                return;
            }
        }

        // Final fallback
        if (songs.length > 0) {

            let nextIndex =
                currentIndex + 1;

            if (
                nextIndex >=
                songs.length
            ) {
                nextIndex = 0;
            }

            if (
                nextIndex !==
                currentIndex
            ) {

                await playSongAtIndex(
                    nextIndex,
                    true
                );
            }
        }

    } finally {

        isTransitioning = false;
    }
}

// ============================================================
// PLAY / PAUSE
// ============================================================

async function togglePlay() {

    // No current song
    if (
        currentIndex === -1 ||
        !audio.src
    ) {

        await playNextAutomaticSong();

        return;
    }

    if (audio.paused) {

        try {

            activePlayPromise =
                audio.play();

            await activePlayPromise;

            activePlayPromise = null;

        } catch (error) {

            activePlayPromise = null;

            console.warn(
                "Resume failed. Trying next song.",
                error
            );

            await playNextAutomaticSong();
        }

    } else {

        audio.pause();
    }

    updatePlayButton();
}

// ============================================================
// NEXT SONG
// ============================================================

function nextSong() {

    // Cancel transition lock
    isTransitioning = false;

    // Invalidate old playback
    playbackGeneration++;

    playNextAutomaticSong();
}

// ============================================================
// PREVIOUS SONG
// ============================================================

async function prevSong() {

    isTransitioning = false;

    playbackGeneration++;

    const filtered =
        getFilteredSongIndexes();

    if (filtered.length === 0) {
        return;
    }

    const position =
        filtered.indexOf(
            currentIndex
        );

    const previousIndex =
        position <= 0
            ? filtered[
                  filtered.length - 1
              ]
            : filtered[position - 1];

    await playSongAtIndex(
        previousIndex,
        false
    );
}

// ============================================================
// EDIT SONG
// ============================================================

async function editSong(index) {

    const song =
        songs[index];

    if (!song) {
        return;
    }

    const newTitle =
        prompt(
            "Edit song title:",
            getSongTitle(song)
        );

    if (newTitle === null) {
        return;
    }

    const newDirector =
        prompt(
            "Edit music director:",
            getSongArtist(song)
        );

    if (newDirector === null) {
        return;
    }

    song.title =
        newTitle.trim() ||
        song.title;

    song.artist =
        newDirector
            .trim()
            .toUpperCase() ||
        song.artist;

    song.director =
        song.artist;

    if (
        song.id !== undefined &&
        song.id !== null
    ) {

        try {

            await updateTrackInDB(
                song
            );

        } catch (error) {

            console.error(
                "Could not update song:",
                error
            );
        }
    }

    updateArtistFilter();

    renderSongList();

    if (
        currentIndex === index
    ) {

        updatePlayerInformation(
            song
        );

        updateMediaSession(
            song
        );
    }
}

// ============================================================
// MEDIA SESSION
// AIRPODS / BLUETOOTH / LOCK SCREEN
// ============================================================

function updateMediaSession(song) {

    if (
        !("mediaSession" in navigator) ||
        !song
    ) {
        return;
    }

    try {

        navigator.mediaSession.metadata =
            new MediaMetadata({

                title:
                    getSongTitle(
                        song
                    ),

                artist:
                    getSongArtist(
                        song
                    ),

                album:
                    "Rishi Music"
            });

        updateMediaPosition();

    } catch (error) {

        console.warn(
            "Media Session metadata error:",
            error
        );
    }
}

function updateMediaPosition() {

    if (
        !("mediaSession" in navigator)
    ) {
        return;
    }

    if (
        !Number.isFinite(
            audio.duration
        ) ||
        audio.duration <= 0
    ) {
        return;
    }

    try {

        if (
            "setPositionState" in
            navigator.mediaSession
        ) {

            navigator.mediaSession.setPositionState(
                {
                    duration:
                        audio.duration,

                    playbackRate:
                        audio.playbackRate ||
                        1,

                    position:
                        Math.min(
                            audio.currentTime,
                            audio.duration
                        )
                }
            );
        }

    } catch (error) {
        // Browser may reject position state
    }
}

function setupMediaSession() {

    if (
        !("mediaSession" in navigator)
    ) {
        return;
    }

    try {

        navigator.mediaSession.setActionHandler(
            "play",
            () => {
                togglePlay();
            }
        );

    } catch (error) {}

    try {

        navigator.mediaSession.setActionHandler(
            "pause",
            () => {

                audio.pause();

                updatePlayButton();
            }
        );

    } catch (error) {}

    try {

        navigator.mediaSession.setActionHandler(
            "nexttrack",
            () => {
                nextSong();
            }
        );

    } catch (error) {}

    try {

        navigator.mediaSession.setActionHandler(
            "previoustrack",
            () => {
                prevSong();
            }
        );

    } catch (error) {}

    try {

        navigator.mediaSession.setActionHandler(
            "seekforward",
            (details) => {

                const skip =
                    details.seekOffset ||
                    10;

                if (
                    Number.isFinite(
                        audio.duration
                    )
                ) {

                    audio.currentTime =
                        Math.min(
                            audio.duration,
                            audio.currentTime +
                                skip
                        );

                    updateMediaPosition();
                }
            }
        );

    } catch (error) {}

    try {

        navigator.mediaSession.setActionHandler(
            "seekbackward",
            (details) => {

                const skip =
                    details.seekOffset ||
                    10;

                audio.currentTime =
                    Math.max(
                        0,
                        audio.currentTime -
                            skip
                    );

                updateMediaPosition();
            }
        );

    } catch (error) {}

    try {

        navigator.mediaSession.setActionHandler(
            "seekto",
            (details) => {

                if (
                    details.seekTime !==
                        undefined &&
                    Number.isFinite(
                        details.seekTime
                    )
                ) {

                    audio.currentTime =
                        details.seekTime;

                    updateMediaPosition();
                }
            }
        );

    } catch (error) {}
}

// ============================================================
// ARTIST / DIRECTOR FILTER
// ============================================================

function getArtists() {

    const artists =
        new Set();

    songs.forEach(
        (song) => {

            const artist =
                getSongArtist(
                    song
                );

            if (
                artist &&
                artist !==
                    "UNKNOWN ARTIST" &&
                artist !==
                    "UNKNOWN DIRECTOR"
            ) {

                artists.add(
                    artist
                );
            }
        }
    );

    return Array.from(
        artists
    ).sort(
        (a, b) =>
            a.localeCompare(b)
    );
}

function updateArtistFilter() {

    const filter =
        document.getElementById(
            "directorFilter"
        );

    if (!filter) {
        return;
    }

    filter.innerHTML = "";

    const allOption =
        document.createElement(
            "option"
        );

    allOption.value =
        "all";

    allOption.textContent =
        "ALL DIRECTORS";

    filter.appendChild(
        allOption
    );

    getArtists().forEach(
        (artist) => {

            const option =
                document.createElement(
                    "option"
                );

            option.value =
                artist;

            option.textContent =
                artist;

            filter.appendChild(
                option
            );
        }
    );

    const exists =
        Array.from(
            filter.options
        ).some(
            (option) =>
                option.value ===
                activeArtist
        );

    filter.value =
        exists
            ? activeArtist
            : "all";

    activeArtist =
        filter.value;
}

// ============================================================
// SONG COUNT
// ============================================================

function updateSongCount() {

    const count =
        document.getElementById(
            "trackCountBadge"
        );

    if (count) {

        count.textContent =
            `${songs.length} song${
                songs.length === 1
                    ? ""
                    : "s"
            }`;
    }
}

// ============================================================
// RENDER SONG LIST
// ============================================================

function renderSongList() {

    const container =
        document.getElementById(
            "songListContainer"
        ) ||
        document.querySelector(
            ".song-list"
        );

    if (!container) {
        return;
    }

    const filtered =
        getFilteredSongIndexes();

    container.innerHTML = "";

    if (
        filtered.length === 0
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "empty-library";

        empty.style.padding =
            "24px";

        empty.style.textAlign =
            "center";

        empty.style.color =
            "rgba(255,255,255,0.5)";

        empty.textContent =
            songs.length === 0
                ? "No songs uploaded yet"
                : "No songs found";

        container.appendChild(
            empty
        );

        return;
    }

    const todayPlayed =
        getDailyPlayedIds();

    filtered.forEach(
        (index) => {

            const song =
                songs[index];

            const isCurrent =
                index ===
                currentIndex;

            const isPlaying =
                isCurrent &&
                !audio.paused;

            const playedToday =
                todayPlayed.includes(
                    song.id
                );

            // Card
            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "song-card" +
                (
                    isCurrent
                        ? " active"
                        : ""
                );

            // Information
            const info =
                document.createElement(
                    "div"
                );

            info.className =
                "song-info";

            const icon =
                document.createElement(
                    "span"
                );

            icon.className =
                "song-icon";

            icon.textContent =
                "♫";

            const meta =
                document.createElement(
                    "div"
                );

            meta.className =
                "song-meta";

            const title =
                document.createElement(
                    "h4"
                );

            title.textContent =
                getSongTitle(
                    song
                );

            const artist =
                document.createElement(
                    "p"
                );

            artist.textContent =
                getSongArtist(
                    song
                ) +
                (
                    playedToday
                        ? " • PLAYED TODAY"
                        : ""
                );

            meta.appendChild(
                title
            );

            meta.appendChild(
                artist
            );

            info.appendChild(
                icon
            );

            info.appendChild(
                meta
            );

            // Actions
            const actions =
                document.createElement(
                    "div"
                );

            actions.className =
                "song-actions";

            actions.style.display =
                "flex";

            actions.style.alignItems =
                "center";

            actions.style.gap =
                "8px";

            // Edit button
            const editBtn =
                document.createElement(
                    "button"
                );

            editBtn.type =
                "button";

            editBtn.className =
                "btn-edit-action";

            editBtn.innerHTML =
                "✎ Edit";

            editBtn.style.padding =
                "6px 12px";

            editBtn.style.fontSize =
                "0.72rem";

            editBtn.style.fontWeight =
                "700";

            editBtn.style.color =
                "#70e1ff";

            editBtn.style.background =
                "rgba(0, 180, 216, 0.12)";

            editBtn.style.border =
                "1px solid rgba(0, 210, 255, 0.35)";

            editBtn.style.borderRadius =
                "12px";

            editBtn.style.cursor =
                "pointer";

            editBtn.style.backdropFilter =
                "blur(8px)";

            editBtn.onclick =
                (event) => {

                    event.stopPropagation();

                    editSong(index);
                };

            // Play button
            const playButton =
                document.createElement(
                    "button"
                );

            playButton.type =
                "button";

            playButton.className =
                "play-mini";

            playButton.style.width =
                "36px";

            playButton.style.height =
                "36px";

            playButton.style.borderRadius =
                "50%";

            playButton.style.display =
                "flex";

            playButton.style.alignItems =
                "center";

            playButton.style.justifyContent =
                "center";

            playButton.style.border =
                "1px solid rgba(255,255,255,0.5)";

            playButton.style.borderTop =
                "1px solid #ffffff";

            playButton.style.background =
                isPlaying
                    ? "linear-gradient(145deg,#00f0ff,#0077b6)"
                    : "linear-gradient(145deg,#56ccf2,#2f80ed)";

            playButton.style.boxShadow =
                "inset 0 1px 2px rgba(255,255,255,0.7), 0 4px 14px rgba(0,180,216,0.5)";

            playButton.style.color =
                "#fff";

            playButton.style.cursor =
                "pointer";

            playButton.textContent =
                isPlaying
                    ? "❚❚"
                    : "▶";

            playButton.onclick =
                (event) => {

                    event.stopPropagation();

                    if (
                        isCurrent
                    ) {

                        togglePlay();

                    } else {

                        playSongAtIndex(
                            index,
                            false
                        );
                    }
                };

            actions.appendChild(
                editBtn
            );

            actions.appendChild(
                playButton
            );

            card.appendChild(
                info
            );

            card.appendChild(
                actions
            );

            card.onclick =
                () => {

                    playSongAtIndex(
                        index,
                        false
                    );
                };

            container.appendChild(
                card
            );
        }
    );
}

// ============================================================
// IMPORT SONGS
// ============================================================

async function importSongs(files) {

    if (
        !files ||
        files.length === 0
    ) {
        return;
    }

    if (!db) {

        alert(
            "Music library is still loading. Please try again."
        );

        return;
    }

    for (
        const file of files
    ) {

        if (
            !file.type.startsWith(
                "audio/"
            )
        ) {
            continue;
        }

        const filename =
            file.name
                .replace(
                    /\.[^/.]+$/,
                    ""
                )
                .trim();

        const track = {

            title:
                filename ||
                "Unknown Song",

            name:
                file.name,

            artist:
                "UNKNOWN DIRECTOR",

            director:
                "UNKNOWN DIRECTOR",

            blob:
                file,

            type:
                file.type,

            size:
                file.size,

            createdAt:
                Date.now()
        };

        try {

            const id =
                await saveTrackToDB(
                    track
                );

            track.id =
                id;

            songs.push(
                track
            );

        } catch (error) {

            console.error(
                "Save error:",
                file.name,
                error
            );
        }
    }

    songs.sort(
        (a, b) =>
            (a.id || 0) -
            (b.id || 0)
    );

    unplayedQueue = [];

    updateArtistFilter();

    updateSongCount();

    renderSongList();

    const input =
        document.getElementById(
            "audioFileInput"
        );

    if (input) {
        input.value = "";
    }
}

// ============================================================
// AUDIO EVENTS
// ============================================================

audio.addEventListener(
    "play",
    () => {

        updatePlayButton();

        renderSongList();

        if (
            "mediaSession" in
            navigator
        ) {

            try {

                navigator.mediaSession.playbackState =
                    "playing";

            } catch (error) {}
        }
    }
);

audio.addEventListener(
    "pause",
    () => {

        updatePlayButton();

        renderSongList();

        if (
            "mediaSession" in
            navigator
        ) {

            try {

                navigator.mediaSession.playbackState =
                    "paused";

            } catch (error) {}
        }
    }
);

audio.addEventListener(
    "ended",
    () => {

        // Automatically play next song
        playNextAutomaticSong();
    }
);

audio.addEventListener(
    "error",
    (event) => {

        console.error(
            "Audio error encountered:",
            event
        );

        updatePlayButton();

        // Try another track automatically
        if (!isTransitioning) {
            playNextAutomaticSong();
        }
    }
);

audio.addEventListener(
    "loadedmetadata",
    () => {

        const totalTime =
            document.getElementById(
                "totalTime"
            );

        if (totalTime) {

            totalTime.textContent =
                formatTime(
                    audio.duration
                );
        }

        updateMediaPosition();
    }
);

audio.addEventListener(
    "timeupdate",
    () => {

        const currentTime =
            document.getElementById(
                "currentTime"
            );

        const progressBar =
            document.getElementById(
                "progressBar"
            );

        if (currentTime) {

            currentTime.textContent =
                formatTime(
                    audio.currentTime
                );
        }

        if (
            progressBar &&
            Number.isFinite(
                audio.duration
            ) &&
            audio.duration > 0
        ) {

            progressBar.value =
                (
                    audio.currentTime /
                    audio.duration
                ) * 100;
        }

        updateMediaPosition();
    }
);

// ============================================================
// CONTROL SETUP
// ============================================================

function setupControls() {

    // Import
    const importInput =
        document.getElementById(
            "audioFileInput"
        );

    if (importInput) {

        importInput.addEventListener(
            "change",
            (event) => {

                importSongs(
                    Array.from(
                        event.target.files
                    )
                );
            }
        );
    }

    // Main player buttons
    const playBtn =
        document.getElementById(
            "playBtn"
        );

    if (playBtn) {

        playBtn.addEventListener(
            "click",
            togglePlay
        );
    }

    const nextBtn =
        document.getElementById(
            "nextBtn"
        );

    if (nextBtn) {

        nextBtn.addEventListener(
            "click",
            nextSong
        );
    }

    const prevBtn =
        document.getElementById(
            "prevBtn"
        );

    if (prevBtn) {

        prevBtn.addEventListener(
            "click",
            prevSong
        );
    }

    // Search
    const searchInput =
        document.getElementById(
            "searchInput"
        );

    if (searchInput) {

        searchInput.addEventListener(
            "input",
            () => {

                searchQuery =
                    searchInput.value;

                renderSongList();
            }
        );
    }

    // Director filter
    const filter =
        document.getElementById(
            "directorFilter"
        );

    if (filter) {

        filter.addEventListener(
            "change",
            () => {

                activeArtist =
                    filter.value;

                unplayedQueue = [];

                renderSongList();
            }
        );
    }

    // Progress bar
    const progressBar =
        document.getElementById(
            "progressBar"
        );

    if (progressBar) {

        progressBar.addEventListener(
            "input",
            () => {

                if (
                    Number.isFinite(
                        audio.duration
                    ) &&
                    audio.duration > 0
                ) {

                    audio.currentTime =
                        (
                            Number(
                                progressBar.value
                            ) / 100
                        ) *
                        audio.duration;
                }
            }
        );
    }

    // Optional mute button
    const muteBtn =
        document.getElementById(
            "muteBtn"
        );

    if (muteBtn) {

        muteBtn.addEventListener(
            "click",
            () => {

                audio.muted =
                    !audio.muted;

                muteBtn.textContent =
                    audio.muted
                        ? "🔇"
                        : "🔊";
            }
        );
    }

    // Optional volume slider
    const volumeBar =
        document.getElementById(
            "volumeBar"
        );

    if (volumeBar) {

        const initialVolume =
            Number(
                volumeBar.value
            );

        if (
            Number.isFinite(
                initialVolume
            )
        ) {

            audio.volume =
                Math.max(
                    0,
                    Math.min(
                        1,
                        initialVolume
                    )
                );
        }

        volumeBar.addEventListener(
            "input",
            () => {

                const volume =
                    Number(
                        volumeBar.value
                    );

                if (
                    Number.isFinite(
                        volume
                    )
                ) {

                    audio.volume =
                        Math.max(
                            0,
                            Math.min(
                                1,
                                volume
                            )
                        );

                    audio.muted =
                        audio.volume ===
                        0;
                }
            }
        );
    }
}

// ============================================================
// INITIALIZE APP
// ============================================================

async function initializeApp() {

    try {

        await openDatabase();

        songs =
            await loadAllTracksFromDB();

        songs.sort(
            (a, b) =>
                (a.id || 0) -
                (b.id || 0)
        );

        updateArtistFilter();

        updateSongCount();

        renderSongList();

        updatePlayerInformation(
            null
        );

        updatePlayButton();

        setupMediaSession();

        console.log(
            "Rishi Music initialized successfully."
        );

        console.log(
            "Songs loaded:",
            songs.length
        );

    } catch (error) {

        console.error(
            "Rishi Music initialization failed:",
            error
        );

        const container =
            document.getElementById(
                "songListContainer"
            );

        if (container) {

            container.innerHTML = `
                <div style="
                    padding:30px;
                    text-align:center;
                    color:#ff7777;
                ">
                    <h3>Rishi Music could not load</h3>
                    <p style="margin-top:10px;color:#999;">
                        Please refresh the page and try again.
                    </p>
                </div>
            `;
        }
    }
}

// ============================================================
// DOM READY
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        setupControls();

        await initializeApp();
    }
);

// ============================================================
// IMPORTANT:
// DO NOT REGISTER sw.js HERE.
//
// index.html should register:
// ./service-worker.js
//
// This prevents the incorrect filename from
// breaking the PWA service-worker setup.
// ============================================================

// ============================================================
// CLEANUP
// ============================================================

window.addEventListener(
    "beforeunload",
    () => {

        try {
            audio.pause();
        } catch (error) {}

        playbackGeneration++;
    }
);