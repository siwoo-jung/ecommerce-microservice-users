# Dockerfile
FROM public.ecr.aws/lambda/nodejs:18

WORKDIR ${LAMBDA_TASK_ROOT}

COPY package*.json ./

RUN npm i

COPY . .

CMD [ "index.handler" ]