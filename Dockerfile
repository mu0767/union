FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py solver.py default-bosses.json index.html styles.css app.js characters.js data.js planner.html planner.css planner.js ./
COPY assets/portraits ./assets/portraits
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
RUN mkdir /data && chown -R nobody:nogroup /data
USER nobody
EXPOSE 8787
CMD ["python", "server.py"]
