/**
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0/
 */

'use strict';

import { database, changePanel, accountSelect, Slider, t, headplayer} from '../utils.js';
import { initOthers } from '../utils/sharedFunctions.js';
const dataDirectory = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME);

const os = require('os');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const pkg = require('../package.json');
const { ipcRenderer, shell } = require('electron');
const settings_url = pkg.user ? `${pkg.settings}/${pkg.user}` : pkg.settings;

/**
 * Classe gérant le panneau des paramètres du launcher
 * @class Settings
 */
class Settings {
    /** @type {string} L'identifiant du panneau */
    static id = "settings";

    /**
     * Initialise le panneau des paramètres
     * @async
     * @method init
     * @param {Object} config - La configuration du launcher
     * @returns {Promise<void>}
     */
    async init(config) {
        this.config = config;
        this.database = await new database().init();
        window.settings = this;
        this.initSettingsDefault();
        this.initTab();
        this.initAccount();
        this.initRam();
        this.initLauncherSettings();        this.updateModsConfig();
        this.initOptionalMods();
        await this.headplayer();

        this.initDragAndDrop();
    }

    /**
     * Rafraîchit les données du panneau
     * @async
     * @method refreshData
     * @returns {Promise<void>}
     */
    async refreshData() {
        document.querySelector('.player-role').innerHTML = '';
        document.querySelector('.player-monnaie').innerHTML = '';
        await this.initOthers();
        await this.initPreviewSkin();
        await this.updateAccountImage();
    }

    /**
     * Met à jour l'image du compte sélectionné
     * @async
     * @method updateAccountImage
     * @returns {Promise<void>}
     */
    async updateAccountImage() {
        const uuid = (await this.database.get('1234', 'accounts-selected')).value;
        const account = (await this.database.get(uuid.selected, 'accounts')).value;
        const azauth = this.getAzAuthUrl();
        const timestamp = new Date().getTime();

        const accountDiv = document.getElementById(account.uuid);
        if (accountDiv) {
            const accountImage = accountDiv.querySelector('.account-image');
            if (accountImage) {
                accountImage.src = `${azauth}api/skin-api/avatars/face/${account.name}/?t=${timestamp}`;
            } else {
                console.error('Image not found in the selected account div.');
            }
        } else {
            console.error(`No div found with UUID: ${account.uuid}`);
        }
    }

    /**
     * Initialise les fonctionnalités supplémentaires
     * @async
     * @method initOthers
     * @returns {Promise<void>}
     */
    async initOthers() {
        await initOthers(this.database, this.config);
    }

    /**
     * Initialise la gestion des comptes
     * @method initAccount
     * @returns {void}
     */
    initAccount() {
        document.querySelector('.accounts').addEventListener('click', async (e) => {
            const uuid = e.target.id;
            const selectedaccount = await this.database.get('1234', 'accounts-selected');

            if (e.path[0].classList.contains('account')) {
                accountSelect(uuid);
                this.database.update({ uuid: "1234", selected: uuid }, 'accounts-selected');
            }

            if (e.target.classList.contains("account-delete")) {
                this.database.delete(e.path[1].id, 'accounts');
                document.querySelector('.accounts').removeChild(e.path[1]);

                const remainingAccounts = await this.database.getAll('accounts');
                const cancelButtons = document.querySelectorAll('.cancel');
                cancelButtons.forEach(button => {
                    button.style.display = remainingAccounts.length > 0 ? 'block' : 'none';
                });

                if (!document.querySelector('.accounts').children.length) {
                    changePanel("login");
                    return;
                }

                if (e.path[1].id === selectedaccount.value.selected) {
                    const newUuid = (await this.database.getAll('accounts'))[0].value.uuid;
                    this.database.update({ uuid: "1234", selected: newUuid }, 'accounts-selected');
                    accountSelect(newUuid);
                }
            }
        });

        document.querySelector('.add-account').addEventListener('click', () => {
            const cancelLoginElement = document.querySelector(".cancel-login");
            if (cancelLoginElement) {
                cancelLoginElement.style.display = "contents";
            }
            changePanel("login");
        });
    }

    /**
     * Initialise la gestion de la RAM
     * @async
     * @method initRam
     * @returns {Promise<void>}
     */
    async initRam() {
        const ramDatabase = (await this.database.get('1234', 'ram'))?.value;
        const totalMem = Math.trunc(os.totalmem() / 1073741824 * 10) / 10;
        const freeMem = Math.trunc(os.freemem() / 1073741824 * 10) / 10;

        document.getElementById("total-ram").textContent = `${totalMem} Go RAM`;
        document.getElementById("free-ram").textContent = `${freeMem} Go RAM disponible`;

        const sliderDiv = document.querySelector(".memory-slider");
        sliderDiv.setAttribute("max", Math.trunc((80 * totalMem) / 100));

        const ram = ramDatabase ? ramDatabase : { ramMin: this.config.ram_min, ramMax: this.config.ram_max };
        const slider = new Slider(".memory-slider", parseFloat(ram.ramMin), parseFloat(ram.ramMax));

        const minSpan = document.querySelector(".slider-touch-left span");
        const maxSpan = document.querySelector(".slider-touch-right span");

        minSpan.setAttribute("value", `${ram.ramMin} Go`);
        maxSpan.setAttribute("value", `${ram.ramMax} Go`);

        slider.on("change", (min, max) => {
            minSpan.setAttribute("value", `${min} Go`);
            maxSpan.setAttribute("value", `${max} Go`);
            this.database.update({ uuid: "1234", ramMin: `${min}`, ramMax: `${max}` }, 'ram');
        });
    }

    /**
     * Met à jour la configuration des mods
     * @async
     * @method updateModsConfig
     * @returns {Promise<void>}
     */
    async updateModsConfig() {
        const modsDir = path.join(`${dataDirectory}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`, 'mods');
        const launcherConfigDir = path.join(`${dataDirectory}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`, 'launcher_config');
        const modsConfigFile = path.join(launcherConfigDir, 'mods_config.json');

        const baseUrl = settings_url.endsWith('/') ? settings_url : `${settings_url}/`;
        const response = await fetch(pkg.env === 'azuriom' ? `${baseUrl}api/centralcorp/mods` : `${baseUrl}utils/mods`);
        const apiMods = await response.json();
        const apiModsSet = new Set(apiMods.optionalMods);

        let localModsConfig;
        try {
            localModsConfig = JSON.parse(fs.readFileSync(modsConfigFile));
        } catch (error) {
            await this.createModsConfig(modsConfigFile);
            localModsConfig = JSON.parse(fs.readFileSync(modsConfigFile));
        }

        for (const localMod in localModsConfig) {
            if (!apiModsSet.has(localMod)) {
                if (!localModsConfig[localMod]) {
                    const modFiles = fs.readdirSync(modsDir).filter(file => file.startsWith(localMod) && file.endsWith('.jar-disable'));
                    if (modFiles.length > 0) {
                        const modFile = modFiles[0];
                        const modFilePath = path.join(modsDir, modFile);
                        const newModFilePath = modFilePath.replace('.jar-disable', '.jar');
                        fs.renameSync(modFilePath, newModFilePath);
                    }
                }
                delete localModsConfig[localMod];
            }
        }

        apiMods.optionalMods.forEach(apiMod => {
            if (!(apiMod in localModsConfig)) {
                localModsConfig[apiMod] = true;
            }
        });

        fs.writeFileSync(modsConfigFile, JSON.stringify(localModsConfig, null, 2));
    }

    /**
     * Initialise les mods optionnels
     * @async
     * @method initOptionalMods
     * @returns {Promise<void>}
     */
    async initOptionalMods() {
        const modsDir = path.join(`${dataDirectory}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`, 'mods');
        const launcherConfigDir = path.join(`${dataDirectory}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`, 'launcher_config');
        const modsConfigFile = path.join(launcherConfigDir, 'mods_config.json');
        const modsListElement = document.getElementById('mods-list');

        if (!fs.existsSync(launcherConfigDir)) {
            fs.mkdirSync(launcherConfigDir, { recursive: true });
        }

        if (!fs.existsSync(modsDir) || fs.readdirSync(modsDir).length === 0) {
            this.displayEmptyModsMessage(modsListElement);
            if (!fs.existsSync(modsConfigFile)) {
                await this.createModsConfig(modsConfigFile);
            }
        } else {
            await this.displayMods(modsConfigFile, modsDir, modsListElement);
        }
    }

    /**
     * Affiche un message lorsque aucun mod n'est trouvé
     * @method displayEmptyModsMessage
     * @param {HTMLElement} modsListElement - L'élément de liste des mods
     * @returns {void}
     */
    displayEmptyModsMessage(modsListElement) {
        const modElement = document.createElement('div');
        modElement.innerHTML = `
            <div class="mods-container-empty">
              <h2>⚠️ Les mods optionnels n'ont pas encore étés téléchargés. Veuillez lancer une première fois le jeu pour pouvoir les configurer, puis redémarrez le launcher. ⚠️<h2>
            </div>`;
        modsListElement.appendChild(modElement);
    }

    /**
     * Crée la configuration des mods
     * @async
     * @method createModsConfig
     * @param {string} modsConfigFile - Le chemin du fichier de configuration
     * @returns {Promise<void>}
     */
    async createModsConfig(modsConfigFile) {
        const baseUrl = settings_url.endsWith('/') ? settings_url : `${settings_url}/`;
        const response = await fetch(pkg.env === 'azuriom' ? `${baseUrl}api/centralcorp/mods` : `${baseUrl}utils/mods`);
        const data = await response.json();
        const modsConfig = {};

        data.optionalMods.forEach(mod => {
            modsConfig[mod] = true;
        });

        fs.writeFileSync(modsConfigFile, JSON.stringify(modsConfig, null, 2));
    }

    /**
     * Affiche la liste des mods
     * @async
     * @method displayMods
     * @param {string} modsConfigFile - Le chemin du fichier de configuration
     * @param {string} modsDir - Le répertoire des mods
     * @param {HTMLElement} modsListElement - L'élément de liste des mods
     * @returns {Promise<void>}
     */
    async displayMods(modsConfigFile, modsDir, modsListElement) {
        let modsConfig;

        try {
            modsConfig = JSON.parse(fs.readFileSync(modsConfigFile));
        } catch (error) {
            await this.createModsConfig(modsConfigFile);
            modsConfig = JSON.parse(fs.readFileSync(modsConfigFile));
        }

        const baseUrl = settings_url.endsWith('/') ? settings_url : `${settings_url}/`;
        const response = await fetch(pkg.env === 'azuriom' ? `${baseUrl}api/centralcorp/mods` : `${baseUrl}utils/mods`);
        const data = await response.json();

        if (!data.optionalMods || !data.mods) {
            console.error('La réponse API ne contient pas "optionalMods" ou "mods".');
            return;
        }

        data.optionalMods.forEach(mod => {
            const modElement = document.createElement('div');
            const modInfo = data.mods[mod];
            if (!modInfo) {
                console.error(`Les informations pour le mod "${mod}" sont manquantes dans "mods".`);
                modElement.innerHTML = `
                <div class="mods-container">
                  <h2>Les informations pour le mod ${mod} n'ont pas étés mises par les administrateurs.<h2>
                   <div class="switch">
                      <label class="switch-label">
                        <input type="checkbox" id="${mod}" name="mod" value="${mod}" ${modsConfig[mod] ? 'checked' : ''}>
                        <span class="slider round"></span>
                      </label>
                  </div>
                </div>
                <hr>`;
                return;
            }

            const modName = modInfo.name;
            const modDescription = modInfo.description || "Aucune description pour ce mod";
            const modLink = modInfo.icon;
            const modRecommanded = modInfo.recommanded;

            modElement.innerHTML = `
                <div class="mods-container">
                  ${modLink ? `<img src="${modLink}" class="mods-icon" alt="${modName} logo">` : ''}
                  <div class="mods-container-text">
                    <div class="mods-container-name">                    
                        <h2>${modName}</h2>
                        <div class="mods-recommanded" style="display: none;">Recommandé</div>
                    </div>
                    <div class="mod-description">${modDescription}</div>
                  </div>
                  <div class="switch">
                    <label class="switch-label">
                      <input type="checkbox" id="${mod}" name="mod" value="${mod}" ${modsConfig[mod] ? 'checked' : ''}>
                      <span class="slider round"></span>
                    </label>
                  </div>
                </div>
                <hr>
            `;

            if (modRecommanded) {
                modElement.querySelector('.mods-recommanded').style.display = 'block';
            }

            modElement.querySelector('input').addEventListener('change', (e) => {
                this.toggleMod(mod, e.target.checked, modsConfig, modsDir, modsConfigFile);
            });

            modsListElement.appendChild(modElement);
        });
    }

    /**
     * Active ou désactive un mod
     * @async
     * @method toggleMod
     * @param {string} mod - Le nom du mod
     * @param {boolean} enabled - Si le mod doit être activé
     * @param {Object} modsConfig - La configuration des mods
     * @param {string} modsDir - Le répertoire des mods
     * @param {string} modsConfigFile - Le chemin du fichier de configuration
     * @returns {Promise<void>}
     */
    async toggleMod(mod, enabled, modsConfig, modsDir, modsConfigFile) {
        const modFiles = fs.readdirSync(modsDir).filter(file => file.startsWith(mod) && (file.endsWith('.jar') || file.endsWith('.jar-disable')));

        if (modFiles.length > 0) {
            const modFile = modFiles[0];
            const modFilePath = path.join(modsDir, modFile);
            const newModFilePath = enabled ? modFilePath.replace('.jar-disable', '.jar') : modFilePath.replace('.jar', '.jar-disable');

            fs.renameSync(modFilePath, newModFilePath);

            modsConfig[mod] = enabled;
            fs.writeFileSync(modsConfigFile, JSON.stringify(modsConfig, null, 2));
        }
    }

    /**
     * Sélectionne un fichier pour le skin
     * @async
     * @method selectFile
     * @returns {Promise<void>}
     */
    async selectFile() {
        const input = document.getElementById('fileInput');
        input.click();

        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            if (file.type !== 'image/png') {
                alert('Le fichier doit être une image PNG.');
                return;
            }
            const img = new Image();
            img.src = URL.createObjectURL(file);
            img.onload = async () => {
                if (img.width !== 64 || img.height !== 64) {
                    alert('L\'image doit faire 64x64 pixels.');
                    return;
                }

                await this.processSkinChange.bind(this)(file);
            };
        };
    }

    /**
     * Traite le changement de skin
     * @async
     * @method processSkinChange
     * @param {File} file - Le fichier du skin
     * @returns {Promise<void>}
     */
    async processSkinChange(file) {
        if (!file) {
            console.error('No file provided');
            return;
        }
        const azauth = this.getAzAuthUrl();
        let uuid = (await this.database.get('1234', 'accounts-selected')).value;
        let account = (await this.database.get(uuid.selected, 'accounts')).value;
        const access_token = account.access_token;
        const formData = new FormData();
        formData.append('access_token', access_token);
        formData.append('skin', file);
        const xhr = new XMLHttpRequest();

        xhr.open('POST', `${azauth}api/skin-api/skins/update`, true);

        xhr.onload = async () => {
            console.log(`XHR Response: ${xhr.response}`);
            if (xhr.status === 200) {
                console.log('Skin updated successfully!');
                await this.initPreviewSkin();
                await this.headplayer();
            } else {
                console.error(`Failed to update skin. Status code: ${xhr.status}`);
            }
        };

        xhr.onerror = () => {
            console.error('Request failed');
        };

        xhr.send(formData);
    }

    /**
     * Initialise l'aperçu du skin
     * @async
     * @method initPreviewSkin
     * @returns {Promise<void>}
     */
    async initPreviewSkin() {
        console.log('initPreviewSkin called');
        const azauth = this.getAzAuthUrl();
        let uuid = (await this.database.get('1234', 'accounts-selected')).value;
        let account = (await this.database.get(uuid.selected, 'accounts')).value;

        let title = document.querySelector('.player-skin-title');
        title.innerHTML = `Skin de ${account.name}`;

        const skin = document.querySelector('.skin-renderer-settings');
        const cacheBuster = new Date().getTime();
        const url = `${azauth}skin3d/3d-api/skin-api/${account.name}/300/400/`;
        skin.src = url;
    }

    /**
     * Initialise la résolution
     * @async
     * @method initResolution
     * @returns {Promise<void>}
     */
    async initResolution() {
        let resolutionDatabase = (await this.database.get('1234', 'screen'))?.value?.screen;
        let resolution = resolutionDatabase ? resolutionDatabase : { width: "1280", height: "720" };

        let width = document.querySelector(".width-size");
        width.value = resolution.width;

        let height = document.querySelector(".height-size");
        height.value = resolution.height;

        let select = document.getElementById("select");
        select.addEventListener("change", (event) => {
            let resolution = select.options[select.options.selectedIndex].value.split(" x ");
            select.options.selectedIndex = 0;

            width.value = resolution[0];
            height.value = resolution[1];
            this.database.update({ uuid: "1234", screen: { width: resolution[0], height: resolution[1] } }, 'screen');
        });
    }

    /**
     * Initialise les paramètres du launcher
     * @async
     * @method initLauncherSettings
     * @returns {Promise<void>}
     */
    async initLauncherSettings() {
        let launcherDatabase = (await this.database.get('1234', 'launcher'))?.value;
        let settingsLauncher = {
            uuid: "1234",
            launcher: {
                close: launcherDatabase?.launcher?.close || 'close-launcher'
            }
        }

        let closeLauncher = document.getElementById("launcher-close");
        let closeAll = document.getElementById("launcher-close-all");
        let openLauncher = document.getElementById("launcher-open");

        if(settingsLauncher.launcher.close === 'close-launcher') {
            closeLauncher.checked = true;
        } else if(settingsLauncher.launcher.close === 'close-all') {
            closeAll.checked = true;
        } else if(settingsLauncher.launcher.close === 'open-launcher') {
            openLauncher.checked = true;
        }

        closeLauncher.addEventListener("change", () => {
            if(closeLauncher.checked) {
                openLauncher.checked = false;
                closeAll.checked = false;
            }
           if(!closeLauncher.checked) closeLauncher.checked = true;
            settingsLauncher.launcher.close = 'close-launcher';
            this.database.update(settingsLauncher, 'launcher');
        })

        closeAll.addEventListener("change", () => {
            if(closeAll.checked) {
                closeLauncher.checked = false;
                openLauncher.checked = false;
            }
            if(!closeAll.checked) closeAll.checked = true;
            settingsLauncher.launcher.close = 'close-all';
            this.database.update(settingsLauncher, 'launcher');
        })

        openLauncher.addEventListener("change", () => {
            if(openLauncher.checked) {
                closeLauncher.checked = false;
                closeAll.checked = false;
            }
            if(!openLauncher.checked) openLauncher.checked = true;
            settingsLauncher.launcher.close = 'open-launcher';
            this.database.update(settingsLauncher, 'launcher');
        })
    }

    /**
     * Initialise les onglets
     * @method initTab
     * @returns {void}
     */
    initTab() {
        let TabBtn = document.querySelectorAll('.tab-btn');
        let TabContent = document.querySelectorAll('.tabs-settings-content');

        for (let i = 0; i < TabBtn.length; i++) {
            TabBtn[i].addEventListener('click', () => {
                if (TabBtn[i].classList.contains('save-tabs-btn')) return;
                for (let j = 0; j < TabBtn.length; j++) {
                    TabContent[j].classList.remove('active-tab-content');
                    TabBtn[j].classList.remove('active-tab-btn');
                }
                TabContent[i].classList.add('active-tab-content');
                TabBtn[i].classList.add('active-tab-btn');
            });
        }

        document.querySelector('.save-tabs-btn').addEventListener('click', () => {
            document.querySelector('.default-tab-btn').click();
            changePanel("home");
            this.refreshData();
        });

        document.getElementById('accounts-tab').innerHTML = `<i class="fas fa-user"></i><span>${t('accounts')}</span>`;
        document.getElementById('ram-tab').innerHTML = `<i class="fab fa-java"></i><span>${t('ram_settings')}</span>`;
        document.getElementById('launch-tab').innerHTML = `<i class="fas fa-rocket"></i><span>${t('launcher_loading')}</span>`;
        document.getElementById('mods-tab').innerHTML = `<i class="fas fa-puzzle-piece"></i><span>${t('optional_mods')}</span>`;
        document.getElementById('skin-tab').innerHTML = `<i class="fas fa-tshirt"></i><span>${t('skin')}</span>`;
        document.getElementById('save-tab').innerHTML = `<i class="fas fa-save"></i><span>${t('save')}</span>`;

        document.getElementById('add-account-btn').innerHTML = `<i class="fas fa-plus"></i> <span>${t('add_account')}</span>`;
        document.getElementById('ram-title').textContent = t('ram_settings');
        document.getElementById('ram-info').innerHTML = t('ram_detailed_info');
        document.getElementById('total-ram').textContent = t('total_ram');
        document.getElementById('free-ram').textContent = t('free_ram');
        document.getElementById('launch-title').textContent = t('launcher_loading');
        document.getElementById('close-launcher-text').textContent = t('close_launcher');
        document.getElementById('close-all-text').textContent = t('close_all');
        document.getElementById('open-launcher-text').textContent = t('open_launcher');
        document.getElementById('mods-title').textContent = t('optional_mods');
        document.getElementById('mods-info').innerHTML = t('mods_detailed_info');
        document.getElementById('skin-title').textContent = t('skin');
    }

    /**
     * Initialise les paramètres par défaut
     * @async
     * @method initSettingsDefault
     * @returns {Promise<void>}
     */
    async initSettingsDefault() {
        if (!(await this.database.getAll('accounts-selected')).length) {
            this.database.add({ uuid: "1234" }, 'accounts-selected')
        }

        if (!(await this.database.getAll('java-path')).length) {
            this.database.add({ uuid: "1234", path: false }, 'java-path')
        }

        if (!(await this.database.getAll('java-args')).length) {
            this.database.add({ uuid: "1234", args: [] }, 'java-args')
        }

        if (!(await this.database.getAll('launcher')).length) {
            this.database.add({
                uuid: "1234",
                launcher: {
                    close: 'close-launcher'
                }
            }, 'launcher')
        }

        if (!(await this.database.getAll('ram')).length) {
            this.database.add({ uuid: "1234", ramMin: "2", ramMax: "4" }, 'ram')
        }

        if (!(await this.database.getAll('screen')).length) {
            this.database.add({ uuid: "1234", screen: { width: "1280", height: "720" } }, 'screen')
        }
    }

    /**
     * Récupère l'URL de base pour AzAuth
     * @method getAzAuthUrl
     * @returns {string} L'URL de base
     */
    getAzAuthUrl() {
        const baseUrl = settings_url.endsWith('/') ? settings_url : `${settings_url}/`;
        return pkg.env === 'azuriom' 
            ? baseUrl 
            : this.config.azauth.endsWith('/') 
            ? this.config.azauth 
            : `${this.config.azauth}/`;
    }

    /**
     * Met à jour l'affichage de la tête du joueur
     * @async
     * @method headplayer
     * @returns {Promise<void>}
     */
    async headplayer() {
        const uuid = (await this.database.get('1234', 'accounts-selected')).value;
        const account = (await this.database.get(uuid.selected, 'accounts')).value;
        headplayer(account.name);
    }

    /**
     * Initialise le système de drag & drop
     * @method initDragAndDrop
     * @returns {void}
     */
    initDragAndDrop() {
        const dragDropZone = document.getElementById('dragDropZone');
        const fileInput = document.getElementById('fileInput');

        if (!dragDropZone || !fileInput) {
            console.error('Drag drop zone or file input not found');
            return;
        }

        dragDropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.add('drag-over');
        });

        dragDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.add('drag-over');
        });

        dragDropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!dragDropZone.contains(e.relatedTarget)) {
                dragDropZone.classList.remove('drag-over');
            }
        });

        dragDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.remove('drag-over');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });

        dragDropZone.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileSelect(e.target.files[0]);
            }
        });
    }

    /**
     * Gère la sélection d'un fichier
     * @async
     * @method handleFileSelect
     * @param {File} file - Le fichier sélectionné
     * @returns {Promise<void>}
     */
    async handleFileSelect(file) {
        if (!file) return;
        
        if (file.type !== 'image/png') {
            alert('Le fichier doit être une image PNG.');
            return;
        }

        const img = new Image();
        img.src = URL.createObjectURL(file);
        
        img.onload = async () => {
            if (img.width > 128 || img.height > 128) {
                alert('L\'image ne doit pas dépasser 128x128 pixels.');
                return;
            }

            await this.processSkinChange(file);
        };
    }

    
}

// Référence globale pour les méthodes appelées depuis le HTML
window.settings = null;

export default Settings;