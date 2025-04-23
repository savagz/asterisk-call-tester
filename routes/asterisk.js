const express = require('express');
const router = express.Router();

// Importar AMIService
const AMIService = require('../services/amiservice');

const fs = require('fs');
const path = require('path');
const FILE_PATH = path.join(__dirname, 'config.json');

// Variable para almacenar la configuración
let config = {
    contexto: '',
    extension: '',
    prioridad: '',
    channel: '',
    cantidadLlamadas: 0,
    managerHost: 'localhost',
    managerPort: '5038',
    managerUser: '',
    managerPassword: '',
    ejecutando: false,
    tiempoInicio: null,
    tiempoFin: null,
    llamadasRealizadas: 0,
    llamadasExitosas: 0,
    llamadasFallidas: 0
};
const config_data = readFromJSON();
if(config_data && config_data.contexto){
    console.debug('Loading JSON Config');
    config = config_data;
}

// Configuración inicial para el servicio AMI (se actualizará con los valores del formulario)
let amiConfig = {
    host: config.managerHost || 'localhost',
    port: config.managerPort || 5038,
    login: config.managerUser || 'admin',
    password: config.managerPassword || 'password'
};

// Crear logger básico (puedes reemplazarlo con tu propio sistema de logging)
const logger = {
    debug: (message) => console.log(`[DEBUG] ${message}`),
    error: (message) => console.error(`[ERROR] ${message}`)
};

// Instanciar el servicio AMI
let amiService = new AMIService(amiConfig, logger);

// Iniciar la conexión AMI cuando se carga el módulo
try {
    amiService.start();
} catch (error) {
    logger.error(`Error al iniciar AMI: ${error.message}`);
}

// Variable para controlar el intervalo de llamadas
let callInterval = null;

// GET - Obtener la configuración actual
router.get('/config', (req, res) => {
    res.json(config);
});

// POST - Actualizar la configuración
router.post('/config', (req, res) => {
    try {
        const { 
            contexto, 
            extension, 
            prioridad, 
            channel, 
            cantidadLlamadas,
            managerHost,
            managerPort,
            managerUser,
            managerPassword
        } = req.body;
        
        // Validar datos requeridos
        if (!contexto || !extension || !prioridad || !channel || !cantidadLlamadas ||
            !managerHost || !managerPort || !managerUser || !managerPassword) {
            return res.status(400).json({ error: 'Todos los campos obligatorios deben ser completados' });
        }

        // Verificar si la configuración del AMI ha cambiado
        const amiChanged = managerHost !== config.managerHost ||
                          parseInt(managerPort) !== parseInt(config.managerPort) ||
                          managerUser !== config.managerUser ||
                          managerPassword !== config.managerPassword;

        // Actualizar configuración
        config = {
            ...config,
            contexto,
            extension,
            prioridad,
            channel,
            cantidadLlamadas: parseInt(cantidadLlamadas),
            managerHost,
            managerPort: parseInt(managerPort),
            managerUser,
            managerPassword,
            llamadasRealizadas: 0,
            llamadasExitosas: 0,
            llamadasFallidas: 0
        };
        saveToJSON(config);

        // Si la configuración del AMI cambió, reiniciar la conexión
        if (amiChanged) {
            try {
                // Detener el servicio AMI actual si existe
                if (amiService) {
                    amiService.stop();
                }
                
                // Actualizar configuración del AMI
                amiConfig = {
                    host: managerHost,
                    port: parseInt(managerPort),
                    login: managerUser,
                    password: managerPassword
                };
                
                // Crear nueva instancia del servicio AMI
                amiService = new AMIService(amiConfig, logger);
                
                // Iniciar nueva conexión AMI
                amiService.start();
                
                logger.debug('Conexión AMI reiniciada con nueva configuración');
            } catch (error) {
                logger.error(`Error al reiniciar conexión AMI: ${error.message}`);
            }
        }

        res.status(200).json({ message: 'Configuración actualizada correctamente', config });
    } catch (error) {
        console.error('Error al actualizar configuración:', error);
        res.status(500).json({ error: 'Error al procesar la solicitud' });
    }
});

// POST - Probar la conexión con Asterisk
router.post('/check-connection', async (req, res) => {
    try {
        // Intentar verificar la conexión con AMI
        const isConnected = await amiService.connectedState();
        
        if (isConnected) {
            logger.debug('Prueba de conexión con AMI exitosa');
            res.status(200).json({ connected: true, message: 'Conexión exitosa con el Manager de Asterisk' });
        } else {
            logger.error('Prueba de conexión con AMI fallida');
            res.status(200).json({ connected: false, error: 'No se pudo conectar con el Manager de Asterisk' });
        }
    } catch (error) {
        logger.error(`Error durante prueba de conexión: ${error.message}`);
        res.status(200).json({ connected: false, error: `Error: ${error.message}` });
    }
});

// GET - Verificar si el sistema está ejecutando llamadas
router.get('/status', (req, res) => {
    // Verificar la conexión con AMI antes de devolver el estado
    const amiConectado = amiService.getAmiConn();
    
    res.json({
        ejecutando: config.ejecutando,
        tiempoInicio: config.tiempoInicio,
        tiempoFin: config.tiempoFin,
        cantidadLlamadas: config.cantidadLlamadas,
        llamadasRealizadas: config.llamadasRealizadas,
        llamadasExitosas: config.llamadasExitosas,
        llamadasFallidas: config.llamadasFallidas,
        managerConnected: amiConectado
    });
});

// POST - Iniciar la ejecución de llamadas
router.post('/start', (req, res) => {
    if (config.ejecutando) {
        return res.status(400).json({ error: 'Ya hay una ejecución en proceso' });
    }

    if (!config.contexto || !config.extension || !config.prioridad || !config.channel || !config.cantidadLlamadas) {
        return res.status(400).json({ error: 'Falta configuración para iniciar las llamadas' });
    }

    // Verificar si AMI está conectado
    if (!amiService.getAmiConn()) {
        return res.status(400).json({ error: 'No hay conexión con AMI. Intente nuevamente más tarde.' });
    }

    try {
        // Actualizar estado
        config.ejecutando = true;
        config.tiempoInicio = new Date();
        config.tiempoFin = null;
        config.llamadasRealizadas = 0;
        config.llamadasExitosas = 0;
        config.llamadasFallidas = 0;

        // Iniciar el intervalo para realizar llamadas
        iniciarLlamadasAsterisk();

        res.status(200).json({ 
            message: 'Ejecución de llamadas iniciada', 
            iniciado: config.tiempoInicio 
        });
    } catch (error) {
        config.ejecutando = false;
        console.error('Error al iniciar llamadas:', error);
        res.status(500).json({ error: 'Error al iniciar la ejecución de llamadas' });
    }
});

// POST - Detener la ejecución de llamadas
router.post('/stop', (req, res) => {
    if (!config.ejecutando) {
        return res.status(400).json({ error: 'No hay una ejecución en proceso' });
    }

    try {
        // Detener el intervalo de llamadas
        detenerLlamadasAsterisk();

        // Actualizar estado
        config.ejecutando = false;
        config.tiempoFin = new Date();

        res.status(200).json({ 
            message: 'Ejecución de llamadas detenida', 
            inicio: config.tiempoInicio,
            fin: config.tiempoFin,
            duracion: (config.tiempoFin - config.tiempoInicio) / 1000 + ' segundos',
            llamadasRealizadas: config.llamadasRealizadas,
            llamadasExitosas: config.llamadasExitosas,
            llamadasFallidas: config.llamadasFallidas
        });
    } catch (error) {
        console.error('Error al detener llamadas:', error);
        res.status(500).json({ error: 'Error al detener la ejecución de llamadas' });
    }
});

// Función para iniciar las llamadas en Asterisk
function iniciarLlamadasAsterisk() {
    logger.debug(`Iniciando prueba de carga con ${config.cantidadLlamadas} llamadas`);
    logger.debug(`Contexto: ${config.contexto}`);
    logger.debug(`Extensión: ${config.extension}`);
    logger.debug(`Prioridad: ${config.prioridad}`);
    logger.debug(`Canal: ${config.channel}`);
    
    // Calcular el intervalo entre llamadas para distribuirlas
    // Asumimos que queremos que la prueba tome aproximadamente 1 minuto por cada 100 llamadas
    const duracionTotalMs = Math.max(60000, Math.min(config.cantidadLlamadas * 600, 600000));
    const intervaloMs = Math.floor(duracionTotalMs / config.cantidadLlamadas);
    
    logger.debug(`Intervalo entre llamadas: ${intervaloMs}ms`);
    
    // Iniciar llamadas a intervalos regulares
    let llamadasPendientes = config.cantidadLlamadas;
    
    callInterval = setInterval(async () => {
        if (llamadasPendientes <= 0 || !config.ejecutando) {
            detenerLlamadasAsterisk();
            return;
        }
        
        realizarLlamada();
        llamadasPendientes--;
        
        // Si ya no hay llamadas pendientes, detener el proceso
        if (llamadasPendientes <= 0) {
            setTimeout(() => {
                if (config.ejecutando) {
                    detenerLlamadasAsterisk();
                }
            }, 5000); // Esperar 5 segundos antes de finalizar para asegurarnos que las últimas llamadas se inicien
        }
    }, intervaloMs);
}

// Función para realizar una llamada individual
async function realizarLlamada() {
    if (!config.ejecutando) return;
    
    try {
        // Incrementar contador de llamadas realizadas
        config.llamadasRealizadas++;
        
        // Generar un identificador único para esta llamada
        const callId = Date.now() + '-' + Math.floor(Math.random() * 1000);
        
        // Formato de canal, puede ser personalizado según necesidades
        const channelName = `${config.channel}/${config.extension}_${callId}`;
        
        logger.debug(`Originando llamada #${config.llamadasRealizadas}: ${channelName}`);
        
        // Llamar al método actionOriginate con los parámetros de configuración
        const result = await amiService.actionOriginate(
            channelName, 
            config.extension, 
            config.contexto, 
            config.prioridad
        );
        
        if (result === 'Success') {
            config.llamadasExitosas++;
            logger.debug(`Llamada #${config.llamadasRealizadas} originada con éxito`);
        } else {
            config.llamadasFallidas++;
            logger.debug(`Fallo al originar llamada #${config.llamadasRealizadas}`);
        }
    } catch (error) {
        config.llamadasFallidas++;
        logger.error(`Error al originar llamada: ${error.message}`);
    }
}

// Función para detener las llamadas en Asterisk
function detenerLlamadasAsterisk() {
    logger.debug('Deteniendo prueba de carga de llamadas');
    
    // Limpiar el intervalo de llamadas
    if (callInterval) {
        clearInterval(callInterval);
        callInterval = null;
    }
    
    // Actualizar estado si aún no se ha hecho
    if (config.ejecutando) {
        config.ejecutando = false;
        config.tiempoFin = new Date();
    }
    
    logger.debug(`Prueba completada: ${config.llamadasRealizadas} llamadas realizadas`);
    logger.debug(`Exitosas: ${config.llamadasExitosas}, Fallidas: ${config.llamadasFallidas}`);
}


// Método para guardar un objeto en el archivo JSON
function saveToJSON(obj) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
    console.log('✅ Datos guardados correctamente.');
  } catch (error) {
    console.error('❌ Error al guardar los datos:', error);
  }
}

// Método para leer un objeto desde el archivo JSON
function readFromJSON() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      console.warn('⚠️ Archivo no encontrado. Retornando objeto vacío.');
      return {};
    }
    const data = fs.readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error al leer los datos:', error);
    return {};
  }
}

module.exports = router;