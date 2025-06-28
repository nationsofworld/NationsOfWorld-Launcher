
/**
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0/
 */

'use strict';

import { logger, database, changePanel, t } from '../utils.js';
const { Launch, Status } = require('minecraft-java-core-azbetter');
const { ipcRenderer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const launch = new Launch();
const pkg = require('../package.json');
const settings_url = pkg.user ? `${pkg.settings}/${pkg.user}` : pkg.settings;


const dataDirectory = process.env.APPDATA || (process.platform == 'darwin' ? `${process.env.HOME}/Library/Application Support` : process.env.HOME);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Classe gérant le panneau d'accueil du launcher
 * @class Home
 */
class Home {
    /** @type {string} L'identifiant du panneau */
    static id = "home";

    /**
     * Initialise le panneau d'accueil
     * @async
     * @method init
     * @param {Object} config - La configuration du launcher
     * @param {Array} news - Les actualités à afficher
     * @returns {Promise<void>}
     */
    async init(config, news) {
        this.database = await new database().init();
        this.config = config;
        this.news = await news;

        this.setStaticTexts();
        this.initNews();
        this.initLaunch();
        this.initStatusServer();
        this.initBtn();
        this.initVideo();
        this.initAdvert();
        this.verifyModsBeforeLaunch();
    }

    /**
     * Définit les textes statiques du panneau
     * @method setStaticTexts
     * @returns {void}
     */
    setStaticTexts() {
        document.getElementById('text-download').textContent = t('verification');
        document.getElementById('server-status').textContent = t('offline');
        document.getElementById('video-title').textContent = t('community_video');
        document.getElementById('play-video-btn').innerHTML = '&#9658;';
        document.getElementById('view-video-btn').textContent = t('view_video');
        document.getElementById('news-title').textContent = t('news');
    }

    /**
     * Initialise l'affichage des actualités
     * @async
     * @method initNews
     * @returns {Promise<void>}
     */
    async initNews() {
        const newsContainer = document.querySelector('.news-list');
        if (this.news) {
            if (!this.news.length) {
                this.createNewsBlock(newsContainer, t('no_news_available'), t('news_follow_here'));
            } else {
                for (const newsItem of this.news) {
                    const date = await this.getDate(newsItem.publish_date);
                    this.createNewsBlock(newsContainer, newsItem.title, newsItem.content, newsItem.author, date);
                }
            }
        } else {
            this.createNewsBlock(newsContainer, t('error_contacting_server'), t('error_contacting_server'));
        }
        this.setServerIcon();
    }

    async initAdvert() {
        const advertBanner = document.querySelector('.advert-banner');
        if (this.config.alert_activate) {
            const message = this.config.alert_msg;
            const firstParagraph = message.split('</p>')[0] + '</p>';
            const scrollingText = document.createElement('div');
            scrollingText.classList.add('scrolling-text');
            scrollingText.innerHTML = `${firstParagraph}`;
            advertBanner.innerHTML = '';
            advertBanner.appendChild(scrollingText);
            scrollingText.classList.toggle('no-scroll', !this.config.alert_scroll);
            advertBanner.style.display = 'block';
        } else {
            advertBanner.style.display = 'none';
        }
    }

    /**
     * Crée un bloc d'actualité
     * @method createNewsBlock
     * @param {HTMLElement} container - Le conteneur parent
     * @param {string} title - Le titre de l'actualité
     * @param {string} content - Le contenu de l'actualité
     * @param {string} [author] - L'auteur de l'actualité
     * @param {Object} [date] - La date de publication
     * @returns {void}
     */
    createNewsBlock(container, title, content, author = '', date = {}) {
        const blockNews = document.createElement('div');
        blockNews.classList.add('news-block', 'opacity-1');
        blockNews.innerHTML = `
            <div class="news-header">
                <div class="header-text">
                    <div class="title">${title}</div>
                </div>
                ${date.day ? `<div class="date"><div class="day">${date.day}</div><div class="month">${date.month}</div></div>` : ''}
            </div>
            <div class="news-content">
                <div class="bbWrapper">
                    <p>${content}</p>
                    ${author ? `<p class="news-author"><span>${author}</span></p>` : ''}
                </div>
            </div>`;
        container.appendChild(blockNews);
    }

    /**
     * Définit l'icône du serveur
     * @method setServerIcon
     * @returns {void}
     */
    setServerIcon() {
        const serverImg = document.querySelector('.server-img');
        serverImg.setAttribute("src", this.config.server_icon);
        if (!this.config.server_icon) {
            serverImg.style.display = "none";
        }
    }

    /**
     * Initialise le système de lancement du jeu
     * @async
     * @method initLaunch
     * @returns {Promise<void>}
     */
    async initLaunch() {
        document.querySelector('.play-btn-sidebar').addEventListener('click', async () => {
            await this.verifyModsBeforeLaunch();
            const opts = await this.getLaunchOptions();
            const playBtn = document.querySelector('.play-btn-sidebar');
            const playIcon = playBtn.querySelector('.play-icon');
            const spinner = playBtn.querySelector('.loading-spinner');
            const info = document.querySelector(".text-download");
            const progressBar = document.querySelector(".progress-bar");

            // Show spinner and hide play icon
            playBtn.classList.add('loading');
            playBtn.disabled = true;
            playIcon.style.display = 'none';
            spinner.style.display = 'block';
            
            // Show bottom progress bar
            this.showBottomProgressBar();
            
            launch.Launch(opts);

            const launcherSettings = (await this.database.get('1234', 'launcher')).value;
            this.setupLaunchListeners(launch, info, progressBar, playBtn, launcherSettings);
        });
    }

    /**
     * Récupère les options de lancement
     * @async
     * @method getLaunchOptions
     * @returns {Promise<Object>} Les options de lancement
     */
    async getLaunchOptions() {
        const urlpkg = this.getBaseUrl();
        const uuid = (await this.database.get('1234', 'accounts-selected')).value;
        const account = (await this.database.get(uuid.selected, 'accounts')).value;
        const ram = (await this.database.get('1234', 'ram')).value;
        const javaPath = (await this.database.get('1234', 'java-path')).value;
        const javaArgs = (await this.database.get('1234', 'java-args')).value;
        const resolution = (await this.database.get('1234', 'screen')).value;
        const launcherSettings = (await this.database.get('1234', 'launcher')).value;

        const screen = resolution.screen.width === '<auto>' ? false : { width: resolution.screen.width, height: resolution.screen.height };

        return {
            url: urlpkg,
            authenticator: account,
            timeout: 10000,
            path: `${dataDirectory}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
            version: this.config.game_version,
            detached: launcherSettings.launcher.close === 'close-all' ? false : true,
            downloadFileMultiple: 30,
            loader: {
                type: this.config.loader.type,
                build: this.config.loader.build,
                enable: this.config.loader.enable,
            },
            verify: this.config.verify,
            ignored: [
                ...(Array.isArray(this.config.ignored) ? this.config.ignored : Object.values(this.config.ignored)),
                "launcher_config",
            ],

            java: this.config.java,
            memory: {
                min: `${ram.ramMin * 1024}M`,
                max: `${ram.ramMax * 1024}M`
            }
        };
    }

    /**
     * Récupère l'URL de base pour les fichiers
     * @method getBaseUrl
     * @returns {string} L'URL de base
     */
    getBaseUrl() {
        const baseUrl = settings_url.endsWith('/') ? settings_url : `${settings_url}/`;
        return pkg.env === 'azuriom' ? `${baseUrl}api/centralcorp/files` : `${baseUrl}data/`;
    }

    /**
     * Configure les écouteurs d'événements du lancement
     * @method setupLaunchListeners
     * @param {Object} launch - L'instance de lancement
     * @param {HTMLElement} info - L'élément d'information
     * @param {HTMLElement} progressBar - La barre de progression
     * @param {HTMLElement} playBtn - Le bouton de jeu
     * @param {Object} launcherSettings - Les paramètres du launcher
     * @returns {void}
     */
    setupLaunchListeners(launch, info, progressBar, playBtn, launcherSettings) {
        launch.on('extract', extract => {
            console.log(extract);
            this.updateBottomProgressBar(0, 100, 'Extraction des fichiers...', 'Décompression en cours');
        });
        launch.on('progress', (progress, size) => {
            this.updateProgressBar(progressBar, info, progress, size, t('download'));
            this.updateBottomProgressBar(progress, size, 'Téléchargement des fichiers...', this.formatSize(progress, size));
        });
        launch.on('check', (progress, size) => {
            this.updateProgressBar(progressBar, info, progress, size, t('verification'));
            this.updateBottomProgressBar(progress, size, 'Vérification des fichiers...', this.formatSize(progress, size));
        });
        launch.on('estimated', time => console.log(this.formatTime(time)));
        launch.on('speed', speed => {
            console.log(`${(speed / 1067008).toFixed(2)} Mb/s`);
            const speedMbs = (speed / 1048576).toFixed(1);
            this.updateBottomProgressBar(null, null, null, `${speedMbs} MB/s`);
        });
        launch.on('patch', patch => {
            info.innerHTML = t('patch_in_progress');
            this.updateBottomProgressBar(100, 100, 'Application du patch...', 'Finalisation en cours');
        });
        launch.on('data', e => this.handleLaunchData(e, info, progressBar, playBtn, launcherSettings));
        launch.on('close', code => this.handleLaunchClose(code, info, progressBar, playBtn, launcherSettings));
        launch.on('error', err => console.log(err));
    }

    /**
     * Met à jour la barre de progression
     * @method updateProgressBar
     * @param {HTMLElement} progressBar - La barre de progression
     * @param {HTMLElement} info - L'élément d'information
     * @param {number} progress - La progression actuelle
     * @param {number} size - La taille totale
     * @param {string} text - Le texte à afficher
     * @returns {void}
     */
    updateProgressBar(progressBar, info, progress, size, text) {
        progressBar.style.display = "block";
        info.innerHTML = `${text} ${((progress / size) * 100).toFixed(0)}%`;
        ipcRenderer.send('main-window-progress', { progress, size });
        progressBar.value = progress;
        progressBar.max = size;
    }

    /**
     * Formate un temps en secondes en une chaîne lisible
     * @method formatTime
     * @param {number} time - Le temps en secondes
     * @returns {string} Le temps formaté
     */
    formatTime(time) {
        const hours = Math.floor(time / 3600);
        const minutes = Math.floor((time - hours * 3600) / 60);
        const seconds = Math.floor(time - hours * 3600 - minutes * 60);
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    /**
     * Gère les données du lancement
     * @method handleLaunchData
     * @param {Object} e - Les données du lancement
     * @param {HTMLElement} info - L'élément d'information
     * @param {HTMLElement} progressBar - La barre de progression
     * @param {HTMLElement} playBtn - Le bouton de jeu
     * @param {Object} launcherSettings - Les paramètres du launcher
     * @returns {void}
     */
    handleLaunchData(e, info, progressBar, playBtn, launcherSettings) {
        new logger('Minecraft', '#36b030');
        if (launcherSettings.launcher.close === 'close-launcher') ipcRenderer.send("main-window-hide");
        ipcRenderer.send('main-window-progress-reset');
        progressBar.style.display = "none";
        info.innerHTML = t('starting');
        
        // Update bottom progress bar for game starting
        this.updateBottomProgressBar(100, 100, 'Lancement du jeu...', 'Démarrage en cours');
        
        // Hide bottom progress bar after a delay
        setTimeout(() => {
            this.hideBottomProgressBar();
        }, 2000);
        
        console.log(e);
    }

    /**
     * Gère la fermeture du lancement
     * @method handleLaunchClose
     * @param {number} code - Le code de sortie
     * @param {HTMLElement} info - L'élément d'information
     * @param {HTMLElement} progressBar - La barre de progression
     * @param {HTMLElement} playBtn - Le bouton de jeu
     * @param {Object} launcherSettings - Les paramètres du launcher
     * @returns {void}
     */
    handleLaunchClose(code, info, progressBar, playBtn, launcherSettings) {
        if (launcherSettings.launcher.close === 'close-launcher') ipcRenderer.send("main-window-show");
        progressBar.style.display = "none";
        info.style.display = "none";
        
        // Hide bottom progress bar
        this.hideBottomProgressBar();
        
        // Reset sidebar play button
        const playIcon = playBtn.querySelector('.play-icon');
        const spinner = playBtn.querySelector('.loading-spinner');
        playBtn.classList.remove('loading');
        playBtn.disabled = false;
        playIcon.style.display = 'block';
        spinner.style.display = 'none';
        
        info.innerHTML = t('verification');
        new logger('Launcher', '#7289da');
        console.log('Close');
    }

    /**
     * Affiche la barre de progression du bas
     * @method showBottomProgressBar
     * @returns {void}
     */
    showBottomProgressBar() {
        const progressBar = document.getElementById('bottom-progress-bar');
        progressBar.style.display = 'block';
        progressBar.classList.remove('hiding');
        progressBar.classList.add('active');
    }

    /**
     * Masque la barre de progression du bas
     * @method hideBottomProgressBar
     * @returns {void}
     */
    hideBottomProgressBar() {
        const progressBar = document.getElementById('bottom-progress-bar');
        progressBar.classList.remove('active');
        progressBar.classList.add('hiding');
        setTimeout(() => {
            progressBar.style.display = 'none';
            progressBar.classList.remove('hiding');
        }, 500);
    }

    /**
     * Met à jour la barre de progression du bas
     * @method updateBottomProgressBar
     * @param {number} progress - La progression actuelle
     * @param {number} total - Le total
     * @param {string} title - Le titre
     * @param {string} details - Les détails
     * @returns {void}
     */
    updateBottomProgressBar(progress, total, title, details) {
        const progressBar = document.getElementById('bottom-progress-bar');
        if (progressBar.style.display === 'none') return;

        const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
        
        document.getElementById('progress-title-bottom').textContent = title;
        document.getElementById('progress-percentage-bottom').textContent = `${percentage}%`;
        document.getElementById('progress-bar-fill-bottom').style.width = `${percentage}%`;
        document.getElementById('progress-details-bottom').textContent = details;
    }

    /**
     * Formate la taille des fichiers
     * @method formatSize
     * @param {number} progress - La progression actuelle
     * @param {number} total - Le total
     * @returns {string} La taille formatée
     */
    formatSize(progress, total) {
        const formatBytes = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };
        
        return `${formatBytes(progress)} / ${formatBytes(total)}`;
    }

    /**
     * Initialise l'état du serveur
     * @async
     * @method initStatusServer
     * @returns {Promise<void>}
     */
    async initStatusServer() {
        const statusText = document.getElementById('server-status');
        const playersCount = document.getElementById('players-count');
        const onlineIndicator = document.querySelector('.online-indicator');

        try {
            const serverPing = await new Status(this.config.status.ip, this.config.status.port).getStatus();

            if (!serverPing.error) {
                statusText.textContent = t('server_online');
                onlineIndicator.classList.remove('offline');
                onlineIndicator.classList.add('online');
                playersCount.textContent = serverPing.playersConnect;
            } else {
                throw new Error('Ping error');
            }
        } catch (error) {
            statusText.textContent = t('offline');
            onlineIndicator.classList.remove('online');
            onlineIndicator.classList.add('offline');
            playersCount.textContent = '0';
        }
    }

    /**
     * Initialise la vidéo YouTube
     * @method initVideo
     * @returns {void}
     */
    initVideo() {
        const videoContainer = document.querySelector('.video-section');
        if (!this.config.video_activate) {
            videoContainer.style.display = 'none';
            return;
        }

        const youtubeVideoId = this.config.video_url;
        const videoType = this.config.video_type;
        let youtubeEmbedUrl;

        if (videoType === 'short') {
            youtubeEmbedUrl = `https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&playsinline=1`;
        } else if (videoType === 'normal') {
            youtubeEmbedUrl = `https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1`;
        } else {
            console.error('Invalid video type specified in the configuration.');
            return;
        }

        const youtubeThumbnailUrl = `https://img.youtube.com/vi/${youtubeVideoId}/0.jpg`;
        const videoThumbnail = videoContainer.querySelector('.youtube-thumbnail');
        const thumbnailImg = videoThumbnail.querySelector('.thumbnail-img');
        const playButton = videoThumbnail.querySelector('.ytb-play-btn');
        const btn = videoContainer.querySelector('.ytb-btn');

        btn.addEventListener('click', () => shell.openExternal(`https://youtube.com/watch?v=${youtubeVideoId}`));

        if (thumbnailImg && playButton) {
            thumbnailImg.src = youtubeThumbnailUrl;
            videoThumbnail.addEventListener('click', () => {
                videoThumbnail.innerHTML = `<iframe width="500" height="290" src="${youtubeEmbedUrl}" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
            });
        }
    }

    /**
     * Initialise les boutons du panneau
     * @method initBtn
     * @returns {void}
     */
    initBtn() {
        document.querySelector('.settings-btn').addEventListener('click', () => changePanel('settings'));
        document.querySelector('.login-btn').addEventListener('click', () => changePanel('login'));
    }

    /**
     * Convertit une date en format lisible
     * @async
     * @method getDate
     * @param {string} e - La date à convertir
     * @returns {Promise<Object>} La date formatée
     */
    async getDate(e) {
        const date = new Date(e);
        return {
            day: date.getDate(),
            month: MONTHS[date.getMonth()]
        };
    }

    /**
     * Vérifie les mods avant le lancement
     * @async
     * @method verifyModsBeforeLaunch
     * @returns {Promise<void>}
     */
    async verifyModsBeforeLaunch() {
        const modsListElement = document.querySelector('.mods-list');
        if (!modsListElement) return;

        const modsDirectory = path.join(dataDirectory, process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`, 'mods');
        if (!fs.existsSync(modsDirectory)) {
            this.displayEmptyModsMessage(modsListElement);
            return;
        }

        const mods = fs.readdirSync(modsDirectory).filter(file => file.endsWith('.jar'));
        if (mods.length === 0) {
            this.displayEmptyModsMessage(modsListElement);
            return;
        }

        modsListElement.innerHTML = '';
        for (const mod of mods) {
            const modElement = document.createElement('div');
            modElement.classList.add('mod-item');
            modElement.textContent = mod;
            modsListElement.appendChild(modElement);
        }
    }

    /**
     * Affiche un message lorsque aucun mod n'est trouvé
     * @method displayEmptyModsMessage
     * @param {HTMLElement} modsListElement - L'élément de liste des mods
     * @returns {void}
     */
    displayEmptyModsMessage(modsListElement) {
        modsListElement.innerHTML = '<div class="mod-item">Aucun mod trouvé</div>';
    }

    /**
     * Met à jour l'affichage du rôle
     * @method updateRole
     * @param {Object} account - Les données du compte
     * @returns {void}
     */
    updateRole(account) {
        const tooltip = document.querySelector('.player-head .player-tooltip');
        if (tooltip) {
            const blockRole = document.createElement("div");
            blockRole.classList.add("player-role");
            blockRole.textContent = `${t('grade')}: ${account.user_info.role.name}`;
            tooltip.appendChild(blockRole);
        }

        this.updateStylishGradeDisplay(account);
    }

    /**
     * Met à jour l'affichage stylé du grade
     * @method updateStylishGradeDisplay
     * @param {Object} account - Les données du compte
     * @returns {void}
     */
    updateStylishGradeDisplay(account) {
        const gradeDisplay = document.getElementById('grade-display');
        const gradeBadge = gradeDisplay.querySelector('.grade-badge');
        const gradeIcon = gradeBadge.querySelector('.grade-icon span');
        const gradeName = gradeBadge.querySelector('.grade-name');
        const gradeDescription = gradeBadge.querySelector('.grade-description');

        if (!account.user_info || !account.user_info.role) return;

        const roleName = account.user_info.role.name.toLowerCase();
        const roleDisplayName = account.user_info.role.name;

        // Remove all grade classes
        gradeBadge.className = 'grade-badge';
        
        // Determine grade class and details
        let gradeClass, iconText, description;
        
        switch (roleName) {
            case 'admin':
            case 'administrateur':
                gradeClass = 'grade-admin';
                iconText = '👑';
                description = 'Administrateur du serveur';
                break;
            case 'moderator':
            case 'modérateur':
            case 'modo':
                gradeClass = 'grade-moderator';
                iconText = '🛡️';
                description = 'Modérateur du serveur';
                break;
            case 'helper':
            case 'aide':
            case 'assistant':
                gradeClass = 'grade-helper';
                iconText = '🤝';
                description = 'Assistant de la communauté';
                break;
            case 'vip':
                gradeClass = 'grade-vip';
                iconText = '⭐';
                description = 'Membre VIP';
                break;
            case 'premium':
                gradeClass = 'grade-premium';
                iconText = '💎';
                description = 'Membre Premium';
                break;
            default:
                gradeClass = 'grade-player';
                iconText = '👤';
                description = 'Joueur';
        }

        // Apply styles and content
        gradeBadge.classList.add(gradeClass);
        gradeIcon.textContent = iconText;
        gradeName.textContent = roleDisplayName;
        gradeDescription.textContent = description;

        // Show the grade display with animation
        gradeDisplay.style.display = 'block';
        setTimeout(() => {
            gradeDisplay.style.opacity = '1';
        }, 100);
    }

    /**
     * Met à jour l'état du bouton de jeu en fonction de la whitelist
     * @method updateWhitelist
     * @param {Object} account - Les données du compte
     * @returns {void}
     */
    updateWhitelist(account) {
        const playBtn = document.querySelector(".play-btn-sidebar");
        if (this.config.whitelist_activate && 
            (!this.config.whitelist.includes(account.name) &&
             !this.config.whitelist_roles.includes(account.user_info.role.name))) {
            playBtn.style.backgroundColor = "#696969";
            playBtn.style.pointerEvents = "none";
            playBtn.style.boxShadow = "none";
            playBtn.classList.add('disabled');
        } else {
            playBtn.style.backgroundColor = "#00bd7a";
            playBtn.style.pointerEvents = "auto";
            playBtn.style.boxShadow = "0 0 10px rgba(0, 189, 122, 0.3)";
            playBtn.classList.remove('disabled');
        }
    }
}

export default Home;
